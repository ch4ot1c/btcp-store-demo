# Pizza Shop 
### store-demo package / bitcore service

Bitcore Backend Example for a store.

- NodeJS
- One static address per-product.
- Uses MongoDB (for both store-demo and bitcore-node-btcp)

To install: [bitcore-install](https://github.com/BTCPrivate/bitcore-install).

Final steps:
- `cd node_modules/store-demo`
- Copy `node_modules/dist/socket.io-client/socket.io.js` into `static/js`
- Set hostURL in both the `store-demo.html` and `index.js`

To run: `mongod &` and then `./bitcore-node start`.

To view: `localhost:8001` or `hostname.com:8001/store-demo/store-demo.html`
