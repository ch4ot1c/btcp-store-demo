'use strict';

var EventEmitter = require('events').EventEmitter;
const fs = require('fs');
const bitcore = require('bitcore-lib');
const bodyParser = require('body-parser');

const mongoose = require('mongoose');
mongoose.Promise = require('bluebird');
global.Promise = mongoose.Promise;

const Merchant = require('./models').Merchant;
const Transaction = require('./models').Transaction;
const Product = require('./models').Product;

//TODO relocate
const SERVER_SECRET = 'key';

const NUM_CONFIRMATIONS = 6;

const DEFAULT_MONGO_URL = 'mongodb://localhost:27017/store-demo';
const hostURL = 'ws://localhost:8001';

// This module will be installed as a service of Bitcore, which will be running on localhost:8001.
// EXAMPLE - `localhost:8001/store-demo/index.html`

let xpub
let addresses = []

function PizzaShop(options) {
  EventEmitter.call(this);

  this.node = options.node;
  this.log = this.node.log;

  //this.log.info(require('util').inspect(self.node));

  var self = this;

  // ** Watch for Bitcore Events **

  //TODO check that other necessary services are started first
  this.node.services.bitcoind.on('tip', function (h) {
    self.log.info('tip');
    self.log.info(h);

    BlockManager.findOneAndUpdate({}, { latest_block_height: h }, { returnNewDocument: true })
      .exec()
      .then(m => {
        if (!m) {
          return Promise.reject('BlockManager doesn\'t exist!!! Run `node init_mongo` offline.');
        } else {
          let maxHeight = self.node.services.bitcoind.height;
          self.log.info('Max Height:' + maxHeight);
          // Confirm + broadcast all unconfirmed Txs that now have n confirmations 
          return Transaction.find({ block_mined: { $gte: m.latest_block_height - NUM_CONFIRMATIONS } }).exec()
        }
      })
      .then(ts => {
        ts.forEach(t => {
          self.node.services.web.io.emit('FINAL_CONFIRM_SEEN', { user_address: t.user_address, height: h, required_confirms: NUM_CONFIRMATIONS })
          //TODO 'required_confirms: n-blocks' in Transaction model? Set?
          //TODO broadcast as FINAL_CONFIRM_SEEN_ + t.blockchain_tx_id?
        })
      })
      .catch(e => {
        self.log.error(e);
      })
  });

  this.node.services.bitcoind.on('hashblock', function (blockHashHex) {
    self.log.info('hashblock');
    self.log.info(blockHashHex);

    // Increment block height for this currency
    BlockManager.findOneAndUpdate({}, { $inc: { latest_block_height: 1 } }, { returnNewDocument: true })
      .exec()
      .then(b => {
        if (!b) { self.log.error('No BlockManager in Mongo!'); return; }
        // Broadcast block
        self.node.services.web.io.emit('BLOCK_SEEN', { height: b.latest_block_height, hash: blockHashHex });
        // Update + Broadcast Transactions that are now fully confirmed
        // TODO
        // (unsubscribe from sender addresses that have no other txs pending)
      });
  });

  /*
  this.node.services.bitcoind.on('bitcoind/addresstxid', function(data) {
    console.info('bitcoind/addresstxid');
    console.log(data);
    // Get and confirm address
    let bitcoreAddress = bitcore.Address(data.address); //TODO z addrs
    let a = bitcoreAddress.toString();
    if (addresses.indexOf(a)<0) { // redundant?
        console.log(a);
        console.log(data.txid);
        //Transaction.create? Already did in rawtransaction, so no
     }
  });*/

  this.node.services.bitcoind.on('rawtx', function (transactionHex) {
    self.log.info('rawtx');
    self.log.info(transactionHex);
    // Get outputs
    let t = bitcore.Transaction(transactionHex);
    //console.log(t);
    let o = t.outputs;
    //console.info(o);

    let p;
    // Find our address in that tx block
    for (var i = 0; i < o.length; i++) {
      let a = bitcore.Address.fromScript(bitcore.Script.fromBuffer(o[i]._scriptBuffer)).toString();
      // Handle only txs corresponding to some product's address
      if (addresses.indexOf(a) < 0) {
        let product = products.filter(x => { return x.address === a; })[0];
        if (!product) { continue; }
        else {
          p = product;
          break;
        }
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

      socket.emit('PAID_NOT_ENOUGH_' + productID, { transaction: t });

      return;

      // Paid too much
    } else if (o[i].satoshis > p.price_satoshis) {
      // Set amount overpaid and alert user
      let difference = o[i].satoshis - p.price_satoshis;
      self.log.error('You have paid ' + (difference / 100000000).toFixed(8) + ' BTCP too much.\n\nPlease contact merchant to discuss any partial refund.');
      self.log.warning('Payment Issue! - TODO ELEGANT HANDLING');
      //TODO - For now, their overpayment is accepted as a donation

      awaitConfirmations(self.node.services.web.io, p.id, p.address_btcp, t.txid);

      // Paid exact amount
    } else {
      awaitConfirmations(self.node.services.web.io, p.id, p.address_btcp, t.txid);
    }
  });


  // ** Begin **

  // Connect to MongoDB (Warning - connect() is Not a real Promise)
  //TODO createConnection, global obj
  mongoose.connect(options.mongoURL || DEFAULT_MONGO_URL)
    .then(() => {
      Merchant.findOne({})
        .select('xpub')
        .exec()
        .then(m => {
          if (!m || m.xpub == null) {
            return Promise.reject('Merchant doesn\'t exist (and/or no xpub has been set)!!! Run `node init_mongo` offline.');
          } else {
            self.xpub = m.xpub;
            return Promise.resolve();
          }
        })
        .then(() => {
          return getAllProducts().then(ps => { self.addresses = ps.map(p => p.btcp_address); }).catch(e => { self.log.error(e) })
        })
        .catch(e => {
          self.log.error(e);
        });
    }, e => { self.log.error(e.message); });

  // TODO elegantly disconnect mongoose, socket.io
}

function awaitConfirmations(socket, productID, address, blockchainTxID) {
  let tJSON = {
    product_id: productID,
    user_address: address,
    satoshis: o[i].satoshis,
    blockchain_tx_id: blockchainTxID
  }
  Transaction.create(tJSON)
    .then(t => {
      socket.emit('PAID_ENOUGH_' + productID, { transaction: t });
    })
    .catch(e => {
      console.error(e.message);
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
    .exec()
    .then(ps => {
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
    if (req.body.key !== SERVER_SECRET) return res.send(401);
    next();
  };

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


  // TODO Separate - 'mongo_init.js' from 'generate_hd_wallet.js'
  // TODO Allow 'xpub' as arg to 'setup_mongo_merchant.js' using commander

  // INPUTS - {price_satoshis: 1, name: 'x', key: 'server_secret'}
  app.post('/products', verifyKey, function (req, res, next) {
    self.log.info('POST /products: ', req.body);

    if (!req.body.price_satoshis || !req.body.name) {
      return res.status(400).send('Fields `price_satoshis` and `name` are required.');
    }

    // Generate next address & create a Product 
    // (DB starts at next_address_index `0`, and post-increments)
    Merchant.findOneAndUpdate({}, { $inc: { next_address_index: 1 } }, { returnNewDocument: false })
      .select('next_address_index')
      .exec()
      .then(m => {
        if (!m || m.xpub == null) {
          return res.status(500).send({ error: 'Merchant doesn\'t exist (and/or no xpub has been set)!!! Run `node generate_hd_wallet` offline.' });
        }

        // Derive next addr from derived xpub
        let a = bitcore.HDPublicKey(xpub).deriveChild("m/0/" + m.next_address_index).publicKey.toAddress();

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

};

PizzaShop.prototype.getRoutePrefix = function () {
  return 'store-demo';
};


// TODO Admin panel - my xpub, my products, txs
// TODO require distinct Product names (mongoose 'unique: true')
// TODO watching z addrs - use viewing key - 'zkY4fCSnTUC7fWiPSduJC2kXGMMcRgDsiAv8C7mdWYnLUxRWVh1ocq4XuGzZSDQAu7mqzJGbFPcEeupnWUL2NUv615J38om'
// TODO optionally handle a deliveryEmail (possible over z memo)

module.exports = PizzaShop;
