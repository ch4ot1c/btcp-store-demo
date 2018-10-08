const mongoose = require('mongoose');
var Schema = mongoose.Schema;
var ObjectId = mongoose.Schema.Types.ObjectId;

// --- Merchant ---

var MerchantSchema = new Schema({
  xpub: {type: String, required: true},
  next_address_index: {type: Number, default: 0} 
}, {timestamps: true});

var Merchant = mongoose.model('Merchant', MerchantSchema);

// --- BlockManager ---
// If a restart is required, we scan forward from known_tip_height to ensure no txs are missed

var BlockManagerSchema = new Schema({
  known_tip_height: {type: String, required: true, default: 0},
}, {timestamps: true});

var BlockManager = mongoose.model('BlockManager', BlockManagerSchema);

// --- Product ---

var ProductSchema = new Schema({
  price_satoshis: {type: Number, required: true},
  address_btcp: {type: String, required: true},
  address_index: {type: String, required: false},
  name: {type: String, required: true},
  file_name: {type: String, required: false}
}, {timestamps: true});

var Product = mongoose.model('Product', ProductSchema);

// --- User ---

var UserSchema = new Schema({
  address_btcp: {type: String, required: true},
  email: {type: String, required: true},
  name: {type: String, required: false}
}, {timestamps: true});

var User = mongoose.model('User', UserSchema);

// --- Transaction - Added once first seen (if relevant) ---

var TransactionSchema = new Schema({
  product_id: {type: ObjectId, ref: 'Product', index: true, required: true},
  receiving_address: {type: String, required: true},
  user_address: String,
  satoshis: {type: Number, required: true},
  blockchain_tx_id: String,
  // Eventually...
  block_mined: Number,
  block_confirmed: Number
}, {timestamps: true});

var Transaction = mongoose.model('Transaction', TransactionSchema);


module.exports = {
  Merchant: Merchant,
  Product: Product,
  User: User,
  Transaction: Transaction,
  BlockManager: BlockManager
};
