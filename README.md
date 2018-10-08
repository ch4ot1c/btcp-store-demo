# Song Shop 
### store-demo package / bitcore service

Bitcore Backend Example for a store.

- NodeJS
- Uses MongoDB (for both store-demo and bitcore-node-btcp)
- One address assigned to each product.

To install: [bitcore-install](https://github.com/BTCPrivate/bitcore-install).

Final steps:
- `cd node_modules/store-demo`
- Copy `node_modules/dist/socket.io-client/socket.io.js` into `static/js`
- Set hostURL in both the `store-demo.html` and `index.js`

To run:
- Fill in `config.json`
- Run MongoDB: `mongod &`
- `./generate_hd_wallet` (Preferably on an offline device) (Write down keys)
- `./create_products <json> (default=demo)`
- `./bitcore-node start`.

To view: `localhost:8001/store-demo`

(Can use iptables to send to port 80/443)

Can also:
- `./list_products`
- `./delete_products`

### Features
- P2PKH Address Watching
- Height-only chain management
- Works with all daemons, even those that don't support HD-wallet import
- SendGrid email product delivery
- Serves JWT link to a file asset
