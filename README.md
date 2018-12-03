# Song Shop 
### store-demo package / bitcore service

Crypto-accepting digital file store, using Bitcore and a full node. No user signup is required, just an email address.

- NodeJS
- Uses MongoDB (for both store-demo and bitcore-node-btcp)
- One address assigned to each product.

To install: [bitcore-install](https://github.com/BTCPrivate/bitcore-install).

Final setup steps:
- `cd node_modules/store-demo`
- Copy `node_modules/dist/socket.io-client/socket.io.js` into `static/js`
- Set hostURL in both the `store-demo.html` and `index.js`

To run:
- Fill in `config.json`
- Run MongoDB: `mongod &`
- `./generate_hd_wallet` (Preferably on an offline device) (Write down keys)
- `./create_products <json> (default=demo)`
- Add files with the same name as the `productID`s, to be sold as your products
- `./bitcore-node start`.

To view:
- `localhost:8001/store-demo`

Can also:
- `./list_products`
- `./delete_products`

(Can use iptables to send to port 80/443)

### Features
- P2PKH Address Watching
- Height-only chain management
- Works with all daemons, even those that don't support HD-wallet import
- SendGrid email product delivery
- Serves JWT link to a file asset
