const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (_env, argv) => ({
  entry: './src/main.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.[contenthash].js',
    // build pro https://app.makuderovi.cz/crossroads/ (npm run upload), dev server zůstává na http://localhost:8080/
    publicPath: argv.mode === 'production' ? '/crossroads/' : '/',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      { test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
    ],
  },
  plugins: [new HtmlWebpackPlugin({ template: './src/index.html' })],
  devtool: argv.mode === 'development' ? 'eval-source-map' : false,
  devServer: {
    port: 8080,
    open: true,
  },
});
