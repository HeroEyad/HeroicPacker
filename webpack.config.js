import path from 'path';
import { fileURLToPath } from 'url';
import webpack from 'webpack';
import CopyPlugin from 'copy-webpack-plugin';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');

export default (_env, argv) => {
	const production = argv.mode === 'production';

	return {
		mode: production ? 'production' : 'development',
		devtool: production ? false : 'eval-source-map',
		entry: ['core-js/stable', './src/client/index.tsx'],
		output: {
			path: path.join(root, 'dist'),
			filename: 'static/js/index.js',
			clean: true
		},
		devServer: {
			static: './dist',
			host: '127.0.0.1',
			port: 4000
		},
		experiments: {
			asyncWebAssembly: true
		},
		module: {
			rules: [
				{ test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ },
				{ test: /\.mst$/, use: 'raw-loader' },
				{ test: /\.m?js$/, resolve: { fullySpecified: false } }
			]
		},
		resolve: {
			extensions: ['.tsx', '.ts', '.js'],
			alias: {
				api: path.join(src, 'api'),
				client: path.join(src, 'client'),
				TypedObserver: path.join(src, 'client/TypedObserver')
			}
		},
		plugins: [
			new webpack.DefinePlugin({
				'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
				PROFILER: JSON.stringify(!production),
				DEBUG: JSON.stringify(!production)
			}),
			new CopyPlugin({
				patterns: [{ from: 'src/client/resources', to: '' }]
			})
		],
		optimization: {
			minimize: production
		},
		performance: {
			hints: false
		}
	};
};
