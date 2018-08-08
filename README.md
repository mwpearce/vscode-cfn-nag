# Visual Studio Cpde Extension for Cfn-Nag Linter

This is a [Visual Studio Code](https://code.visualstudio.com) Extension from running [cfn-nag](https://github.com/stelligent/cfn_nag) to lint your CloudFormation templates.

## Features

Uses [cfn-nag](https://github.com/stelligent/cfn_nag) to parse and show issues with CloudFormation templates.

For example, if you define a Resource named *Role* and specify a resource with an asterisk or an action with an asterisk, errors and warnings are reported.

![Preview](https://github.com/mwpearce/Cfn-Nag-Extension/blob/master/images/preview.png)

## Requirements

Requires [cfn-nag](https://github.com/stelligent/cfn_nag) to be installed: `gem install cfn-nag`

## Extension Settings

This extension provides the following settings:

```javascript
	// (Optional) Path to cfn_nag script
	"cfnNagLint.path": "cfn_nag",

	// (Optional) Path to extra rule directory
	"cfnNagLint.ruleDirectory": "",

	// (Optional) Path to a profile file
	"cfnNagLint.profilePath": "",

	// (Optional) Path to a JSON file to pull Parameter values from
	"cfnNagLint.parameterValuesPath": ""
```

## Known Issues

Bug reports are welcomed.

## License

This extension is open-sources under the MIT license in the LICENSE file of this repository.