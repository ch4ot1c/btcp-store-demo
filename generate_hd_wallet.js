'use strict';

// BTCP - BIP44 + BIP39 / HD wallet setup

const Mnemonic = require('bitcore-mnemonic');

const hdAccount = 0;
const externalAddrPath = "m/44'/183'/" + hdAccount + "'"; // BIP-0044 + SLIP-0044
const seed = new Mnemonic(Mnemonic.Words.ENGLISH); // Generate

// Mongoose
const mongoose = require('mongoose');
const DUMMY_MONGO_URL = 'mongodb://localhost:27017/store-demo';
mongoose.Promise = require('bluebird'); //finally()

const Merchant = require('./models.js').Merchant;
const Product = require('./models.js').Product;

// Generate everything
var xprv = seed.toHDPrivateKey();
var xpub = xprv.hdPublicKey;

var derivedHDPublicKey = xprv.deriveChild(externalAddrPath).hdPublicKey;
var derivedXpubkey = derivedHDPublicKey.xpubkey.toString();

// Connect to mongoose
mongoose.connect(DUMMY_MONGO_URL);

// Store derived xpub (for address generation) in only one mongodb Merchant
Merchant.findOne({})
.exec()
.then(m => {
  if (m) {
    // Update/Replace?
    if (m.xpub == null) {
      m.xpub = derivedXpubkey;
      reportWalletInfo();
      return m.save();
    } else { // Don't touch existing xpub
      //console.log(m.xpub);
      return mongoose.Promise.reject('\nYou already have a Merchant and xpub in MongoDB, for address generation!!! Script canceled.');
    }
  } else {
    return Merchant.create({xpub: derivedXpubkey});
  }
})
.then(m => {
  console.log('Merchant created in MongoDB!');
  //console.log(m);

  reportXpubSaved();

  // EXAMPLE - MongoDB dummy products for Pizza Shop
  return createDummyProducts();
})
.then(ps => {
  // EXAMPLE - derive address by index - this normally occurs at API endpoint `/next_address`
  let index = 0;
  let address = baseHDPublicKey.deriveChild("m/0/" + index).publicKey.toAddress();
  console.log(`\nAddress at index ${index}: ${address}`);

  reportComplete();
})
.catch(e => {
  console.error(e);
})
.finally(() => {
  mongoose.disconnect();
});


function createDummyProducts() {
  return Promise.all([
    Product.create({name: 'pizza_whole', price_satoshis: '800'}),
    Product.create({name: 'pizza_half', price_satoshis: '400'}),
    Product.create({name: 'pizza_oneslice', price_satoshis: '100'})
  ]).then(ps => {
    console.log(`\nDummy products created in MongoDB! - `);
    console.log(`\n${ps}`);
  })
}

function reportWalletInfo() {
  console.log('\nWarning - These keys are only displayed once! - Write down this information!');

  //TODO console.log("Press 'Y' to generate and display your Master Private Key");
  //TODO bright colors

  console.log('\n---');

  console.log('\nPrivate Keys:');
  console.log('\n(SHH! - you never need to input or display these, even on your own server.)');

  console.log('\nMaster Private Key (xprv at m): ');
  console.log(xprv.toString());

  console.log('\nMnemonic Seed Words (easier to write down) (The "HD Derivation Path" you\'ll need for these is m/44\'/183\'/0\'): ');
  console.log(seed.toString());

  console.log('\n\nPublic Keys (these can only be used to generate addresses): ');

  console.log('\nMaster Public Key (xpub at m): ');
  console.log(xpub.toString());

  console.log('\nDerived HD Public Key (xpub at m/44\'/183\'/0\') (wallet #0)');
  console.log(derivedXpubkey);

  console.log('\n---');

}

function reportXpubSaved() {
  console.log('The **Derived HD Public Key** is now stored on your server, in MongoDB, for address generation.');
}

function reportComplete() {
  console.log('\nTry the demo - localhost:8001/store-demo/index.html - Use the dummy `product._id` values\n');
}
