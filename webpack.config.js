const fs = require('fs');
const path = require('path');
const { DefinePlugin } = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

// .env.json (není v gitu): { "apiKey": "klíč k Mapy.com REST API" }
const envFile = path.resolve(__dirname, '.env.json');
const env = fs.existsSync(envFile) ? JSON.parse(fs.readFileSync(envFile, 'utf8')) : {};

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
  plugins: [
    new HtmlWebpackPlugin({ template: './src/index.html' }),
    new DefinePlugin({ MAPY_API_KEY: JSON.stringify(env.apiKey ?? '') }),
  ],
  devtool: argv.mode === 'development' ? 'eval-source-map' : false,
  // worker URL of maplibre-gl is set explicitly in src/route/mapView.ts
  ignoreWarnings: [{ module: /maplibre-gl\.mjs$/, message: /Critical dependency/ }],
  devServer: {
    port: 8080,
    open: true,
  },
});
