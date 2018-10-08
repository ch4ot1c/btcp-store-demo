'use strict';

const mongoose = require('mongoose');
mongoose.Promise = require('bluebird'); //finally()

const Merchant = require('./models.js').Merchant;
const BlockManager = require('./models.js').BlockManager;
const Product = require('./models.js').Product;

const config = require('./config');

// Ask which (list)
// Confirm
// Mark product isDeleted (leave transaction history)
// Alert deleted productID
// TODO
