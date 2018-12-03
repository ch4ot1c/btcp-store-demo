'use strict';

const mongoose = require('mongoose');
mongoose.Promise = require('bluebird'); //finally()

const Merchant = require('./models.js').Merchant;
const BlockManager = require('./models.js').BlockManager;
const Product = require('./models.js').Product;

const HDPublicKey = require('bitcore-lib').HDPublicKey;

const config = require('./config');

// Prompt for name
// Prompt for price
// Create Product
// Alert products 
// TODO use file_name?

var DEMO_INPUT = [{name: "product1", price_satoshis: 101}, {name: "product2", price_satoshis: 101}]
var input = DEMO_INPUT

var merchant
var products
var derivedXpub

// Connect to MongoDB
mongoose.connect(config.mongo_url)

Merchant.findOne({}).exec()
.then(m => {
  //console.log(m)
  if (!m.xpub) return
  merchant = m
  derivedXpub = new HDPublicKey(m.xpub)
 
  // 'Generate' addresses
  input.forEach(i => {
    i.address_btcp = addressAtIndex(m.next_address_index).toString()
    m.next_address_index++
  })
  return Product.create(input)
})
.then(ps => {
  products = ps
  return merchant.save()
})
.then(m_f => {
  console.log(products)
  //console.log(m_f)
})
.catch(e => console.error(e))
.finally(() => mongoose.disconnect())

function addressAtIndex(index) {
  return derivedXpub.deriveChild("m/0/" + index).publicKey.toAddress();
}

