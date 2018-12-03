'use strict';

const mongoose = require('mongoose');
mongoose.Promise = require('bluebird'); //finally()

const Merchant = require('./models.js').Merchant;
//const BlockManager = require('./models.js').BlockManager;
//const Product = require('./models.js').Product;

const config = require('./config');

// Connect to MongoDB
mongoose.connect(config.mongo_url);

Merchant.findOne({}).exec()
  .then(m => {
    console.log(m.xpub)
  })
.finally(() => { mongoose.disconnect() })
