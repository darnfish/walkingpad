module.exports = {
	'env': {
		'browser': true,
		'es6': true
	},
	'settings': {
		'react': {
			'version': 'detect'
		}
	},
	'extends': [
		'eslint:recommended',
		'plugin:@typescript-eslint/eslint-recommended'
	],
	'globals': {
		'Atomics': 'readonly',
		'SharedArrayBuffer': 'readonly'
	},
	'parser': '@typescript-eslint/parser',
	'plugins': [
		'@typescript-eslint'
	],
	'rules': {
		'indent': [
			'error',
			'tab'
		],
		'no-unused-vars': 'off',
		'react/prop-types': 'off',
		'@typescript-eslint/no-unused-vars': 'error',
		'@typescript-eslint/no-explicit-any': [
			'off'
		],
		'@typescript-eslint/explicit-module-boundary-types': [
			'off'
		],
		'prefer-const': [
			'error'
		],
		'nonblock-statement-body-position': [
			'error', 'below'
		],
		'no-sequences': [
			'error'
		],
		'eol-last': [
			'error', 'always'
		],
		'one-var': [
			'error', 'never'
		],
		'one-var-declaration-per-line': [
			'error', 'always'
		],
		'linebreak-style': [
			'error',
			'unix'
		],
		'quotes': [
			'error',
			'single'
		],
		'semi': [
			'error',
			'never'
		]
	}
}
