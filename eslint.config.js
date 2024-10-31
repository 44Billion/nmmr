import neostandard from 'neostandard'
import globals from 'globals'

export default [
  ...neostandard({
    // options
  }), {
    languageOptions: {
      globals: {
        // won't trigger no-undef for window variables
        ...globals.browser,
        ...globals.mocha,
        // myCustomGlobal: '<readonly|writable|off>'
      }
    },
    rules: {
      '@stylistic/comma-dangle': 'off', // trailling comma
      '@stylistic/lines-between-class-members': 'off',
      'import/no-anonymous-default-export': 'off',
      'no-debugger': 'off'
    }
  }
]
