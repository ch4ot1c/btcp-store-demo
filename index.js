'use strict';

var EventEmitter = require('events').EventEmitter;
const fs = require('fs');
const bitcore = require('bitcore-lib');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

//const io = require('socket.io');

const Merchant = require('./models').Merchant;
const Invoice = require('./models').Invoice;
const Product = require('./models').Product;

const DUMMY_MONGO_URL = 'mongodb://localhost:27017/store-demo';

// This module will be installed as a service of Bitcore, which will be running on localhost:8001.
// EXAMPLE - `localhost:8001/store-demo/index.html`

function PizzaShop(options) {
  EventEmitter.call(this);

  this.node = options.node;
  this.log = this.node.log;

  this.invoiceHtml = fs.readFileSync(__dirname + '/invoice.html', 'utf8');

  // Connect to MongoDB (Warning - connect() is Not a real Promise)
  //TODO createConnection, global obj
  mongoose.connect(options.mongoURL || DUMMY_MONGO_URL)
  .then(() => {
    Merchant.findOne({})
    .select('xpub')
    .exec()
    .then(m => {
      if (!m || m.xpub == null) {
        return mongoose.Promise.reject("xpub hasn't been set!!! Run `node generate_hd_wallet` offline.");
      } else {
        this.xpub = m.xpub;
      }
    })
    .catch(e => {
      this.log.error(e);
    });
  }, e => { this.log.error(e.message); });


  //TODO Implement State Machine: AWAITING_PAYMENT -> FULL_AMOUNT_RECEIVED / TIMED_OUT / PARTIAL_AMOUNT_RECEIVED
  //TODO reuse code from invoice.html (client)

/* TODO socket config
  var socket = io('http://localhost:8001');
  socket.emit('subscribe', 'bitcoind/addresstxid', ['{{address}}']);
  socket.on('bitcoind/addresstxid', function(data) {
   var address = bitcore.Address(data.address);
   this.log.info(address);
     //TODO save an entry in db for each confirmed payment, for each relevant addr
     // index (or address), tx_id, address_paid, amount_paid, latest_paid_time, total_satoshis
  });
*/

  //TODO disconnect mongoose, socket.io

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


PizzaShop.prototype.setupRoutes = function(app, express) {
  var self = this;

  app.use(bodyParser.urlencoded({extended: true}));

  // Serve 'static' dir at localhost:8001
  app.use('/', express.static(__dirname + '/static'));


  // *** Invoice server model ***
  // To generate an invoice,
  // POST localhost:8001/invoice {productID: String}
  // TODO Rate limit per ip
  // TODO deliveryEmail (optional)

  // TODO represent as state machine on both client and srv - AWAITING_PAYMENT -> FULL_AMOUNT_RECEIVED / TIMED_OUT / PARTIAL_AMOUNT_RECEIVED

  app.get('/products', function(req, res, next) {
    self.log.info('GET /products: ', req.body);

    Product.find({})
    .exec()
    .then(ps => {
      return res.status(200).send(ps);
    })
    .catch(e => {
      self.log.error(e);
      return res.status(500).send({error: 'Failed to find Products in Mongo'});
    });

  });

  app.post('/invoice', function(req, res, next) {
    self.log.info('POST /invoice: ', req.body);
    var productID = req.body._id || req.body.productID;
    var xpub;
    var addressIndex;

    // Generate next/fresh address & present invoice
    // (DB starts at addressIndex `0`, and post-increments)
    Merchant.findOneAndUpdate({}, {$inc: {address_index: 1}}, {returnNewDocument: false})
    .exec()
    .then(m => {
      addressIndex = m.address_index;
      xpub = m.xpub;
      return Product.findById(productID).exec();
    })
    .then(p => {
      if (!p) {
        return mongoose.Promise.reject('Product not found in DB!');
      }
      return Invoice.create({address_index: addressIndex, product_id: p._id, total_satoshis: p.price_satoshis});
    })
    .then(i => {
      // Derive address, and append to response
      // Here, "/0/" == External addrs, "/1/" == Internal (change) addrs
      var address = bitcore.HDPublicKey(xpub).deriveChild("m/0/" + addressIndex).publicKey.toAddress();

      // Hash, aka the H of P2PKH or P2SH
      //i.hash = i.address.hashBuffer.toString('hex');

      self.log.info('New invoice; generated address:', address);

      let json = i.toObject();
      json.address = address.toString();

      return res.status(200).send(json);
    })
    .catch(e => {
      self.log.error(e);
      return res.status(500).send({error: 'Failed to find Merchant/create Invoice in Mongo'});
    });
  });
};

PizzaShop.prototype.getRoutePrefix = function() {
  return 'store-demo';
};

// Not in use - Content-Type: text/html
PizzaShop.prototype.buildInvoiceHTML = function(invoice) {
  var transformed = this.invoiceHtml
    .replace(/{{price}}/g, invoice.price_satoshis / 1e8)
    .replace(/{{address}}/g, invoice.address)
    .replace(/{{hash}}/g, invoice.hash)
    .replace(/{{baseUrl}}/g, '/' + this.getRoutePrefix() + '/');
  return transformed;
};

module.exports = PizzaShop;
