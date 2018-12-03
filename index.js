'use strict';

var EventEmitter = require('events').EventEmitter;
const fs = require('fs');
const bitcore = require('bitcore-lib-btcp');
const bodyParser = require('body-parser');

const mongoose = require('mongoose');
mongoose.Promise = require('bluebird');
global.Promise = mongoose.Promise;

const sendgridClient = require('sendgrid');
var jwt = require('jsonwebtoken');

const Merchant = require('./models').Merchant;
const BlockManager = require('./models').BlockManager;
const Transaction = require('./models').Transaction;
const Product = require('./models').Product;
const User = require('./models').User;

const config = require('./config.json');

// This module works as a Bitcore service. Runs on port 8001 by default.
// Requires a BTCP daemon, with open rpc port 7932.
//
// Example page: `localhost:8001/store-demo/store-demo.html`

let merchantXpub
var products = []

function PizzaShop(options) {
  EventEmitter.call(this);

  this.node = options.node;
  this.log = this.node.log;

  //this.log.info(require('util').inspect(self.node));

  var self = this;

  // ** Watch for Bitcore Events **

  //TODO check that other necessary services are started first
  //TODO handle remaining events - 'ready', 'syncd', 'error'
  this.node.services.bitcoind.on('tip', function (block) {
    self.log.info('Event - tip: ', block.height);

    // TODO make sure incr'd one; if not, account (reorg? or ffw).
    BlockManager.findOneAndUpdate({}, { known_tip_height: block.height }, { new: true })
      .exec()
      .then(m => {
        if (!m) {
          return Promise.reject('BlockManager doesn\'t exist!!! Run `node init_mongo` offline.');
        } else {
          // Broadcast saved Block Height
          self.node.services.web.io.emit('BLOCK_SEEN', { height: m.known_tip_height });
          //let maxHeight = self.node.services.bitcoind.height;
          
          // Read this new block; if any 'block_mined == -1' tx mongo obj receives a txo in it, update its numconfs to 1
          Transaction.update({block_mined: -1, blockchain_tx_id: {$in: block.tx}}, {block_mined: block.height})
          .exec()
          .then(ts => {
            console.log(ts)
            console.log('Assigning height to unconfirmed all txs seen: ', ts.length, block.height)
            console.log(ts)
              /* With full txs:
              t.vout.forEach(v => {
                //let vAddr = bitcoinjs.address.fromOutputScript(v.scriptPubKey)
                let vAddr = bitcore.Address.fromScript(v.scriptPubKey, 'livenet').toString()
                console.log(vAddr)
                let known = ts.find({receiving_address: vAddr})
                known.forEach(t_k => {
                  t_k.block_mined = m.known_tip_height
                  //TODO reverify rest (amount, txid, input)
                })
              })
              */
          })
          .then(ts_ => {
            // Confirm all unconfirmed txs that now have n confirmations
            //TODO 'required_confirms: n-blocks' in Transaction model? Set+save?
            console.log('Selecting all unconfirmed txs that now have been confirmed')
            return Transaction.find({ block_mined: m.known_tip_height }).exec()
          })
          .then(ts => {
            console.log('Transactions on-deck:')
            console.log(ts)
            if (!ts || ts.length === 0) { console.log('no txs of interest'); return; }

            User.find({address_btcp: { $in: ts.map(t => t.user_address) }}).exec()
            .then(us => {
              console.log(us)
              if (!us || us.length === 0) { console.log('user not found'); return; }

              ts.forEach(t => { //TODO batch
                // using SendGrid's Node.js Library
                // https://github.com/sendgrid/sendgrid-nodejs
                var sendgrid = sendgridClient(config.sendgrid_api_key)
                var email = new sendgrid.Email();

                console.log(us)
                email.addTo(us.find(u => { return u.address_btcp === t.user_address }).email);
                email.setFrom(config.from_email);
                email.setSubject("Store demo - Initial Receipt");
                let txt = 'This is your initial receipt. blockchain txid: ' + t.blockchain_tx_id + ', sent from address: ' + t.user_address + ', received for product: ' + t.product_id;
                email.setHtml(txt);

                sendgrid.send(email);
                console.log('sent email')
                //TODO retrieve, deliver a product as a URL

                self.node.services.web.io.emit('FINAL_CONFIRM_SEEN', { user_address: t.user_address, height: block.height, required_confirms: config.num_confirmations, blockchain_txid: t.blockchain_tx_id })
                //TODO broadcast as FINAL_CONFIRM_SEEN_ + t.blockchain_tx_id? (currently no)
                return Promise.resolve()
              })
            })
            .catch(e => {
              self.log.error(e);
            })
          })
          .catch(e => {
            self.log.error(e);
          })
        }
      });
  });
 
  this.node.services.bitcoind.on('tx', function (transactionHex) {
    self.log.info('Event - tx');
    //self.log.info(transactionHex);
    // Get outputs
    let t = bitcore.Transaction(transactionHex);
    //console.log(t);
    let o = t.outputs;
    //console.log(o);

    let p;
    for (var i = 0; i < o.length; i++) {
      // Find our address in that output 
      let a = bitcore.Address.fromScript(bitcore.Script.fromBuffer(o[i]._scriptBuffer)).toString();
      // Handle only txs corresponding to products' addresses
      //self.log.info(a)
      //self.log.info(self.products)
      let product = products.filter(x => { return x.address_btcp === a })[0];
      if (product) { 
        p = product;
        break;
      }
    }

    if (!p) { return; }

    // Check whether user has paid enough -
    // Three Cases - too little, too much, exact amount
    // Default Forgiveness Threshold = 5000 sats
    const FORGIVENESS_SATOSHIS = 5000;

    // Paid too little (5000 sats or less under required amount)
    if (o[i].satoshis < p.price_satoshis - FORGIVENESS_SATOSHIS) {
      // Set amount to pay and alert user
      let difference = p.price_satoshis - o[i].satoshis;
      self.log.error('You have paid ' + (difference / 100000000).toFixed(8) + ' BTCP too little.\n\nYour transaction will not be processed, but should be saved in the merchant\'s database.');
      self.log.error('Payment Issue! - TODO ELEGANT HANDLING');

      self.log.info(t)
      socket.emit('PAID_NOT_ENOUGH_' + p._id, { transaction: t });

      return;

      // Paid too much
    } else if (o[i].satoshis > p.price_satoshis) {
      // Set amount overpaid and alert user
      let difference = o[i].satoshis - p.price_satoshis;
      self.log.error('You have paid ' + (difference / 100000000).toFixed(8) + ' BTCP too much.\n\nPlease contact merchant to discuss any partial refund.');
      self.log.warn('Payment Issue! - TODO ELEGANT HANDLING');
      //TODO - For now, their overpayment is accepted as a donation

      
      self.log.info(JSON.stringify(t.inputs))
      let ua = bitcore.Address.fromScript(bitcore.Script.fromBuffer(t.inputs[0]._scriptBuffer)).toString();
      saveTxAndWait(self.log, self.node.services.web.io, ua, o[i].satoshis, p, t.id);

      // Paid exact amount
    } else {
      self.log.info(t.inputs)
      //TODO multiple input addrs
      let ua = bitcore.Address.fromScript(bitcore.Script.fromBuffer(t.inputs[0]._scriptBuffer)).toString();
      saveTxAndWait(self.log, self.node.services.web.io, ua, o[i].satoshis, p, t.id);
    }
  });


  // ** Begin **

  // Connect to MongoDB (Warning - connect() is Not a real Promise)
  //TODO createConnection, global obj
  mongoose.connect(config.mongo_url)
    .then(() => {
      Merchant.findOne({})
        .select('xpub')
        .exec()
        .then(m => {
          if (!m || m.xpub == null) {
            return Promise.reject('Merchant doesn\'t exist (and/or no merchant xpub has been set)!!! Run `node init_mongo` offline.');
          } else {
            self.merchantXpub = m.xpub;
            console.log('Using xpub ', m.xpub);
            return Promise.resolve();
          }
        })
        .then(() => {
          return getAllProducts().then(ps => { products = ps }).catch(e => { self.log.error(e) })
        })
        .catch(e => {
          self.log.error(e);
        });
    }, e => { self.log.error(e.message); });

  // TODO elegantly disconnect mongoose, socket.io
}

function saveTxAndWait(log, socket, whoPaid, amountPaid, product, blockchainTxID) {
  let tJSON = {
    product_id: product._id,
    user_address: whoPaid,
    receiving_address: product.address_btcp,
    satoshis: amountPaid, 
    blockchain_tx_id: blockchainTxID
  }
  Transaction.create(tJSON)
    .then(t => {
      //log.info(t);
      let token = jwt.sign({
	      data: 'test'
      }, (config.global_jwt_secret + 'x' + product._id), { expiresIn: '1h' });

      var link = "http://" + config.hostname + "/store-demo/s/" + product._id + "?jwt=" + token;

      socket.emit('PAID_ENOUGH_' + product._id, { transaction: t, jwt: token, delivery: link});

      User.find({address_btcp: t.user_address}).exec()
      .then(u => {
        console.log(JSON.stringify(u))
	
        var sendgrid = sendgridClient(config.sendgrid_api_key);
        var email = new sendgrid.Email();

	email.addTo(u[0].email);
	email.setFrom(config.from_email);
        email.setSubject("Your receipt: " + config.hostname);
        var htmlString = "This is your initial receipt - blockchain txid: ";
        htmlString += blockchainTxID;
        htmlString += "\n";
        htmlString += link; 
	email.setHtml(htmlString);

        sendgrid.send(email);
        console.log('Email sent!');
      })
      .catch(e => {
        log.error(e);
      });
    })
    .catch(e => {
      log.error(e);
    });
}


PizzaShop.dependencies = ['bitcoind'];

PizzaShop.prototype.start = function (callback) {
  setImmediate(callback);
};

PizzaShop.prototype.stop = function (callback) {
  setImmediate(callback);
};

PizzaShop.prototype.getAPIMethods = function () {
  return [];
};

PizzaShop.prototype.getPublishEvents = function () {
  return [];
};

// 1 address per product.
function getAllProducts() {
  return Product.find()
    .sort({createdAt: 'desc'})
    .exec()
    .then(ps => {
      console.log(ps)
      return Promise.resolve(ps.map(p => p.toObject()))
    })
    .catch(e => {
      return Promise.reject(e)
    })
}
// TODO pagination options

PizzaShop.prototype.setupRoutes = function (app, express) {
  var self = this;

  app.use(bodyParser.urlencoded({ extended: true }));

  // Serve 'static' dir at localhost:8001
  app.use('/', express.static(__dirname + '/static'));

  // (Shop Owner Auth)
  var verifyKey = function (req, res, next) {
    if (req.body.key !== config.master_server_secret) return res.send(401);
    next();
  };

  var verifyJWT = function (req, res, next) {
  }

  // TODO Rate limit per ip
  // {userAddress: 'b1xxx', userEmail: 'a@a.com'}
  app.post('/guestbook', function (req, res, next) {
    self.log.info('POST /guestbook: ', req.body);

    //TODO validation
    var userAddress = req.body.userAddress;
    var userEmail = req.body.userEmail;

    // save to db - if address is present, if new email AND 1 hour hasn't passed, update email for addr
    // or
    // they can set a password for this email... TODO

    User.findOne({address_btcp: userAddress})
    .exec()
    .then(u => {
      if (!u) {
        if (!userAddress || !userEmail) return res.sendStatus(400);
        User.create({address_btcp: userAddress, email: userEmail})
        .then(x => {
          return res.sendStatus(201);
        })
        .catch(err => {
          self.log.error(err);
          return res.sendStatus(500);
        })
      } else if (u.address_btcp === userAddress) {
         // Update (maybe after >1h since last update, or otherwise) - NO
         // An email is already registered for this input address. They must message the administrator with a proof of ownership to get it reset.
        /*
         u.email = userEmail;
         u.save().exec().then(x => { return res.sendStatus(204); }).catch(e => { return res.status(500).send({error: e.message}); })
         */
         return res.status(400).send({error: 'Address already registered with an email'});
      } else {
        return res.sendStatus(500);
      }
    })
    .catch(e => {
      self.log.error(e);
      return res.status(500).send({ error: e.message })
    })
  })


  // TODO Rate limit per ip
  app.get('/products', function (req, res, next) {
    self.log.info('GET /products: ', req.body);

    getAllProducts()
      .then(ps => {
        return res.status(200).send(ps)
      })
      .catch(e => {
        self.log.error(e);
        return res.status(500).send({ error: e.message })
      })
  })


  // INPUTS - {price_satoshis: 1, name: 'x', key: 'server_secret'}
  app.post('/products', verifyKey, function (req, res, next) {
    self.log.info('POST /products: ', req.body);

    if (!req.body.price_satoshis || !req.body.name) {
      return res.status(400).send('Fields `price_satoshis` and `name` are required.');
    }

    // Generate next address & create a Product 
    // (DB starts at next_address_index `0`, and post-increments)
    Merchant.findOneAndUpdate({}, { $inc: { next_address_index: 1 } }, { returnOriginal: false })
      .select('next_address_index')
      .exec()
      .then(m => {
        if (!m || m.xpub == null) {
          return res.status(500).send({ error: 'Merchant doesn\'t exist (and/or no xpub has been set)!!! Run `node generate_hd_wallet` offline.' });
        }

        // Derive next addr from derived xpub
        let a = require('bitcore-lib').HDPublicKey(merchantXpub).deriveChild("m/0/" + m.next_address_index).publicKey.toAddress();

        let pJSON = {
          name: req.body.name,
          price_satoshis: req.body.price_satoshis,
          address_btcp: a.toString(),
          address_index: m.next_address_index
        };

        return Product.create(pJSON);
      })
      .then(p => {
        return res.status(200).send(p.toObject());
      })
      .catch(e => {
        self.log.error(e);
        return res.status(500).send({ error: e.message });
      });
  });


  app.get('/s/:productID', function (req, res, next) {
    self.log.info('GET /s/' + req.params.productID, req.body);

    let token = req.query.jwt
    var productID = req.params.productID
    try {
      var decoded = jwt.verify(token, config.global_jwt_secret + 'x' + productID)
    } catch(err) {
      self.log.error(err)
      return res.status(400).send()
    }
    console.log('Successfully decoded jwt:', decoded)

    Product.findById(productID)
    .exec()
    .then(p => {
      //console.log(__dirname);
      // TODO validate productID, get filetype

      // Serve the file requested
      // TODO could also use file_name
      return res.download('songs/' + productID + '.flac', p.name + '.flac')
    })
  });

};

PizzaShop.prototype.getRoutePrefix = function () {
  return 'store-demo';
};


// TODO Admin panel - my xpub, my products, txs
// TODO require distinct Product names (mongoose 'unique: true')
// TODO watching z addrs
// TODO Separate - 'mongo_init.js' from 'generate_hd_wallet.js'
// TODO Allow 'xpub' as arg to 'setup_mongo_merchant.js' using commander

module.exports = PizzaShop;
