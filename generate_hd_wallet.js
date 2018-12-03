'use strict';

const mongoose = require('mongoose');
mongoose.Promise = require('bluebird'); //finally()

const Merchant = require('./models.js').Merchant;
const BlockManager = require('./models.js').BlockManager;
const Product = require('./models.js').Product;

const config = require('./config');

const Mnemonic = require('bitcore-mnemonic');

const hdAccount = 0;
const externalAddrPath = "m/44'/183'/" + hdAccount + "'"; // BIP-0032 x BIP-0039 x BIP-0044 x SLIP-0044 (BTCP)

// WARNING: Private keys should always be generated OFFLINE. Running this script on a remote server is not recommended! You can stay safe by only inputting the 'xpub', for address generation.

// Visit https://wallet.btcprivate.org for an offline option.

// Generate BIP39 mnemonic seed
const seed = new Mnemonic(Mnemonic.Words.ENGLISH);
// Use this to get other HD info 
var xprv = seed.toHDPrivateKey();
var xpub = xprv.hdPublicKey;

var derivedHDPublicKey = xprv.deriveChild(externalAddrPath).hdPublicKey;
var derivedXpubkey = derivedHDPublicKey.xpubkey.toString();

// Connect to MongoDB
mongoose.connect(config.mongo_url);

// Create BlockManager singleton
BlockManager.findOne({})
.exec()
.then(bm => {
  if (bm) {
    console.warn('Already have a BlockManager... skipping creation');
    return mongoose.Promise.resolve(bm);
  } else {
    return BlockManager.create({});
  }
})
.then(bm => {
  // Create Merchant singleton, storing derivedXpubkey (for address generation)
  return Merchant.findOne({}).exec()
})
.then(m => {
  if (m) {
    // Update/Replace?
    if (m.xpub == null) {
      m.xpub = derivedXpubkey;
      //reportWalletInfo();
      return m.save();
    } else { // Don't touch existing xpub
      //console.log(m.xpub);
      return mongoose.Promise.reject('\nYou already have a Merchant and xpub in MongoDB, for address generation!!! Script canceled.');
      //return Promise.resolve(m);
    }
  } else {
    return Merchant.create({xpub: derivedXpubkey});
  }
})
.then(m => {
  console.log('Merchant configured in MongoDB!');
  //console.log(m);

  reportXpubSaved();
  reportComplete();
  reportWalletInfo();

  return mongoose.Promise.resolve();
})
.then(() => {

})
.catch(e => { console.log(e) })
.finally(() => { mongoose.disconnect() })


function addressAtIndex(index) {
  return derivedHDPublicKey.deriveChild("m/0/" + index).publicKey.toAddress();
}


/*
createDummyProducts()
.then(ps => { console.log(ps); })
.catch(e => { console.error(e); })
.finally(() => mongoose.disconnect())
*/

function createDummyProducts() {
  return Promise.all([
   /*
   Product.create({name: 'E', price_satoshis: '100', address_btcp: addressAtIndex(3), file_name: 'e_lo.flac'}),
   Product.create({name: 'A', price_satoshis: '100', address_btcp: addressAtIndex(4), file_name: 'a.flac'}),
   Product.create({name: 'D', price_satoshis: '100', address_btcp: addressAtIndex(5), file_name: 'd.flac'}),
   Product.create({name: 'G', price_satoshis: '100', address_btcp: addressAtIndex(6), file_name: 'g.flac'}),
   Product.create({name: 'B', price_satoshis: '100', address_btcp: addressAtIndex(7), file_name: 'b.flac'}),
   Product.create({name: 'e', price_satoshis: '100', address_btcp: addressAtIndex(8), file_name: 'e_hi.flac'})
   */
  ])
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
  console.log('\nThe **Derived HD Public Key** is now stored on your server, in MongoDB, for address generation.');
}

function reportComplete() {
  console.log('\nTry the demo - localhost:8001/store-demo/index.html - Use the dummy `product._id` values\n');
}
