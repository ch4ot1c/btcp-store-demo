'use strict';

const mongoose = require('mongoose');
mongoose.Promise = require('bluebird'); //finally()

const Merchant = require('./models.js').Merchant;
const BlockManager = require('./models.js').BlockManager;
const Product = require('./models.js').Product;

const HDPublicKey = require('bitcore-lib').HDPublicKey;

const config = require('./config');

mongoose.connect(config.mongo_url)

Merchant.findOne({}).exec()
.then(m => {
  return Product.find({}).exec()
})
.then(ps => { console.log(ps) })
.catch(e => { console.log(e) })
.finally(() => { mongoose.disconnect() })

