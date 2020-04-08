# Visual Studio Code Extension for Cfn-Nag Linter

This is a [Visual Studio Code](https://code.visualstudio.com) Extension for running [cfn-nag](https://github.com/stelligent/cfn_nag) to lint your CloudFormation templates.

## Features

Uses [cfn-nag](https://github.com/stelligent/cfn_nag) to parse and show issues with CloudFormation templates.

For example, if you define a Resource named *Role* and specify a resource with an asterisk or an action with an asterisk, errors and warnings are reported.

![Preview](https://github.com/mwpearce/vscode-cfn-nag/raw/master/images/preview.png)

## Requirements

Requires [cfn-nag](https://github.com/stelligent/cfn_nag) to be installed: `gem install cfn-nag`

## Extension Settings

This extension provides the following settings:

```javascript
  // Path to cfn_nag script. Default: cfn_nag
  "cfnNagLint.path": "cfn_nag",

  // Path to extra rule directory. Default: empty
  "cfnNagLint.ruleDirectory": "",

  // Path to a profile file. Default: empty
  "cfnNagLint.profilePath": "",

  // Path to a JSON file to pull Parameter values from. Default: empty
  "cfnNagLint.parameterValuesPath": "",

  // Minimum problem level to report: WARN, FAIL. Default: WARN
  "cfnNagLint.minimumProblemLevel": "FAIL",

  // Allow using Metadata to suppress violations. Default: true
  "cfnNagLint.allowSuppression": true

  // Output additional information for debugging purposes. Default: false
  "cfnNagLint.debug": true,

  // Path to file that contains a list of rules to NEVER apply
  "cfnNagLint.blacklistPath": "",

  //Path to a JSON file that contains values to control the behavior of conditions
  "cfnNagLint.conditionValuesPath": ""
```

## Known Issues

Bug reports are welcomed.

## License

This extension is open-sourced under the MIT license in the LICENSE file of this repository.