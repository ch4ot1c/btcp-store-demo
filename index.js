'use strict';

var EventEmitter = require('events').EventEmitter;
const fs = require('fs');
const bitcore = require('bitcore-lib');
const bodyParser = require('body-parser');

const mongoose = require('mongoose');
mongoose.Promise = require('bluebird');
global.Promise = mongoose.Promise;

const io = require('socket.io-client');

const Merchant = require('./models').Merchant;
const Transaction = require('./models').Transaction;
const Product = require('./models').Product;

//TODO relocate
const SERVER_SECRET = 'key';

const DEFAULT_MONGO_URL = 'mongodb://localhost:27017/store-demo';
const hostURL = 'ws://localhost:8001';

// This module will be installed as a service of Bitcore, which will be running on localhost:8001.
// EXAMPLE - `localhost:8001/store-demo/index.html`

function PizzaShop(options) {
  EventEmitter.call(this);

  this.node = options.node;
  this.log = this.node.log;

  var self = this;
  //this.log.info(require('util').inspect(self.node));
  //this.log.info(this.node.services.bitcoind.height);
  this.node.services.bitcoind.on('tip', function(x) {
    self.log.info('tip');
    self.log.info(x);
  });

  // Connect to MongoDB (Warning - connect() is Not a real Promise)
  //TODO createConnection, global obj
  mongoose.connect(options.mongoURL || DEFAULT_MONGO_URL)
  .then(() => {
    Merchant.findOne({})
    .select('xpub')
    .exec()
    .then(m => {
      if (!m || m.xpub == null) {
        return Promise.reject('Merchant doesn\'t exist (and/or no xpub has been set)!!! Run `node generate_hd_wallet` offline.');
      } else {
        this.xpub = m.xpub;
        return Promise.resolve();
      }
    })
    .then(() => {
      return getAllProducts().then(ps => { startSocket(hostURL, ps.map(p => p.btcp_address)) }).catch(e => { self.log.error(e) })
    })
    .catch(e => {
      self.log.error(e);
    });
  }, e => { self.log.error(e.message); });



// TODO Socket.io - serverside watching + db updates
// TODO verification as accounting for batches of Transactions on tip updates

// TODO elegantly disconnect mongoose, socket.io

}

PizzaShop.dependencies = ['bitcoind'];

PizzaShop.prototype.start = function(callback) {
  setImmediate(callback);
};

PizzaShop.prototype.stop = function(callback) {
  setImmediate(callback);
};

PizzaShop.prototype.getAPIMethods = function() {
  return [];
};

PizzaShop.prototype.getPublishEvents = function() {
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

PizzaShop.prototype.setupRoutes = function(app, express) {
  var self = this;

  app.use(bodyParser.urlencoded({extended: true}));

  // Serve 'static' dir at localhost:8001
  app.use('/', express.static(__dirname + '/static'));

  // (Owner Auth)
  var verifyKey = function (req, res, next) {
    if (req.body.key !== SERVER_SECRET) return res.send(401);
    next();
  };

  // *** 'Moneyholes' model ***
  // All Product data -
  // GET localhost:8001/products

  // TODO Rate limit per ip
  app.get('/products', function(req, res, next) {
    self.log.info('GET /products: ', req.body);

    getAllProducts()
    .then(ps => {
      return res.status(200).send(ps)
    })
    .catch(e => {
      self.log.error(e);
      return res.status(500).send({error: e.message})
    })
  })



  // TODO Separate - 'setup_mongo_merchant.js' from 'generate_hd_wallet.js'
  // TODO Allow 'xpub' as arg to 'setup_mongo_merchant.js' using commander

  // INPUTS - {price_satoshis: 1, name: 'x'}
  app.post('/products', verifyKey, function(req, res, next) {
    self.log.info('POST /products: ', req.body);
    if (!req.body.price_satoshis || !req.body.name) {
      return res.status(400).send('Fields `price_satoshis` and `name` are required.');
    }

    // Generate next address & create a Product 
    // (DB starts at next_address_index `0`, and post-increments)
    Merchant.findOneAndUpdate({}, {$inc: {next_address_index: 1}}, {returnNewDocument: false})
    .select('next_address_index')
    .exec()
    .then(m => {
      if (!m || m.xpub == null) {
        return res.status(500).send({error: 'Merchant doesn\'t exist (and/or no xpub has been set)!!! Run `node generate_hd_wallet` offline.'});
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
      return res.status(500).send({error: e.message});
    })

  });
  // TODO Admin panel - my xpub, my products, txs
  // TODO require distinct Product names (mongoose 'unique: true')

};

PizzaShop.prototype.getRoutePrefix = function() {
  return 'store-demo';
};


/* Socket.io */

// TODO watching z addrs - use viewing key - 'zkY4fCSnTUC7fWiPSduJC2kXGMMcRgDsiAv8C7mdWYnLUxRWVh1ocq4XuGzZSDQAu7mqzJGbFPcEeupnWUL2NUv615J38om'
// Products, from DB (mocked)


function updateSocketSubscriptions(addresses) {
    //TODO test - socket.emit('unsubscribe', 'bitcoind/addresstxid', addresses);
    socket.emit('subscribe', 'bitcoind/addresstxid', addresses);
}

function unsubscribeToAll() {
    // Subscribe to hashblock, rawtransaction, and addresstxid channels
    socket.emit('unsubscribe', 'bitcoind/hashblock');
    socket.emit('unsubscribe', 'bitcoind/hashblockheight');
    socket.emit('unsubscribe', 'bitcoind/rawtransaction');
    //TODO test - socket.emit('unsubscribe', 'bitcoind/addresstxid');
}

let socket;
function startSocket(url, addresses) {
    var self = this;
    // Connect to socket.io
    socket = io(hostURL);

    // Subscribe to hashblock, rawtransaction, and addresstxid channels
    socket.emit('subscribe', 'bitcoind/hashblock');
    socket.emit('subscribe', 'bitcoind/hashblockheight');
    socket.emit('subscribe', 'bitcoind/rawtransaction');

    socket.emit('subscribe', 'bitcoind/addresstxid', addresses);

    // Handlers -
    // (Some of these re-broadcast an ack to the connected client)
 
    socket.on('bitcoind/hashblock', function(blockHashHex) {
      console.info('bitcoind/hashblock');
      console.log(blockHashHex);

      // Increment block height for this currency
      BlockManager.findOneAndUpdate({}, {$inc: {latest_block_height: 1}}, {returnNewDocument: true})
      .exec()
      .then(b => {
        if (!b) { console.error('No BlockManager in Mongo!'); return; }
        // Broadcast block
        socket.emit('BLOCK_SEEN', {height: b.latest_block_height, hash: blockHashHex}); 
        // Update + Broadcast Transactions that are now fully confirmed
        // TODO
        // (unsubscribe from sender addresses that have no other txs pending)
      });
    });

    socket.on('bitcoind/addresstxid', function(data) {
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
    });

    socket.on('bitcoind/rawtransaction', function(transactionHex) {
        console.info('bitcoind/rawtransaction');
        //console.info(transactionHex);
        // Get outputs
        let t = bitcore.Transaction(transactionHex);
        //console.log(t);
        let o = t.outputs;
        //console.info(o);
        // Find our address in that tx block
        for (var i = 0; i < o.length; i++) {
            let a = bitcore.Address.fromScript(bitcore.Script.fromBuffer(o[i]._scriptBuffer)).toString(); 
            // Handle only txs corresponding to some product's address
            if (addresses.indexOf(a)<0) { // redundant?
              let p = products.filter(x => { return x.address === a; })[0];
              if (!p) { continue; }

              // Check user has paid correct amount -
              // Three Cases - too little, too much, exact amount
              // Default Forgiveness Threshold = 5000 sats
              const FORGIVENESS_SATOSHIS = 5000;
              // Paid too little (5000 sats or less under required amount)
              if (o[i].satoshis < p.price_satoshis - FORGIVENESS_SATOSHIS) {
                // Set amount to pay and alert user
                let difference = p.price_satoshis - o[i].satoshis;
                console.log('You have paid '+(difference/100000000).toFixed(8)+' BTCP too little.\n\nYour transaction will not be processed, but should be saved in the merchant\'s database.');
                console.error('Payment Issue! - TODO ELEGANT HANDLING');
              // Paid too much
              } else if (o[i].satoshis > p.price_satoshis) {
                // Set amount overpaid and alert user
                let difference = o[i].satoshis - p.price_satoshis;   
                console.log('You have paid '+(difference/100000000).toFixed(8)+' BTCP too much.\n\nPlease contact merchant to discuss any partial refund.');
                console.warning('Payment Issue! - TODO ELEGANT HANDLING');

                //TODO for now, their overpayment is accepted as a donation

                // Permit order to proceed
                awaitConfirmations();
              // Paid correct amount
              } else {
                awaitConfirmations();
              }
              break;
           }
        }
    });
    // TODO optionally handle a deliveryEmail (possible over z memo)
}

function awaitConfirmations(productID, address, blockchainTxID) {
  let tJSON = {
    product_id: productID,
    user_address: address,
    satoshis: o[i].satoshis,
    blockchain_tx_id: blockchainTxID
  }
  Transaction.create(tJSON)
  .then(t => {
    console.log(t);
    socket.emit('PAID_ENOUGH_' + productID, {transaction: t});
  })
  .catch(e => {
    console.error(e.message);
  });
}


module.exports = PizzaShop;
