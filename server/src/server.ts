'use strict';

import {
    createConnection,
    TextDocuments,
    Diagnostic,
    DiagnosticSeverity,
    ProposedFeatures,
    IConnection,
    InitializeResult,
    Position,
    InitializeParams,
    DidChangeConfigurationNotification,
    TextDocumentSyncKind
} from 'vscode-languageserver';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';

import { exec } from 'child_process';
import { isArray } from 'util';

const connection: IConnection = createConnection(ProposedFeatures.all);

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;

connection.onInitialize((params: InitializeParams): InitializeResult => {
    const capabilities = params.capabilities;
    hasConfigurationCapability = capabilities.workspace && !!capabilities.workspace.configuration;
    hasWorkspaceFolderCapability = capabilities.workspace && !!capabilities.workspace.workspaceFolders;

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Full
        }
    };
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true
            }
        };
    }

    return result;
});

connection.onInitialized(() => {
    if (hasConfigurationCapability) {
        connection.client.register(
            DidChangeConfigurationNotification.type,
            undefined
        );
    }

    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(_event => {
            connection.console.log('Workspace folder change event received.')
        })
    }
})

// documents.onDidSave((event) => {
//     connection.console.log('Running cfn-nag-lint...');
//     validateCloudFormationFile(event.document);
// });

// documents.onDidOpen((event) => {
//     validateCloudFormationFile(event.document);
// });

interface CfnNagLintSettings {
    path: string;
    ruleDirectory: string;
    profilePath: string;
    parameterValuesPath: string;
    minimumProblemLevel: string;
    allowSuppression: boolean;
    debug: boolean;
    blacklistPath: string;
    conditionValuesPath: string;
}

const defaultSettings: CfnNagLintSettings = {
    path: 'cfn_nag',
    parameterValuesPath: '',
    profilePath: '',
    ruleDirectory: '',
    minimumProblemLevel: 'WARN',
    allowSuppression: true,
    debug: false,
    blacklistPath: '',
    conditionValuesPath: ''
};

let globalSettings: CfnNagLintSettings = defaultSettings;
let documentSettings: Map<string, Thenable<CfnNagLintSettings>> = new Map();
let documentTimers: Map<string, NodeJS.Timer> = new Map();
let isValidating: Map<string, boolean> = new Map();
let settings: CfnNagLintSettings;

connection.onDidChangeConfiguration((change) => {
    if (hasConfigurationCapability) {
        documentSettings.clear();
        documentTimers.clear();
    }
    else {
        globalSettings = <CfnNagLintSettings>((change.settings.cfnNagLint || defaultSettings));
    }

    documents.all().forEach(validateCloudFormationFile);
});

async function getDocumentSettings(resource: string): Promise<CfnNagLintSettings> {
    if (!hasConfigurationCapability) {
        return globalSettings;
    }
    let result = documentSettings.get(resource);
    if (!result) {
        result = await connection.workspace.getConfiguration({
            scopeUri: resource,
            section: 'cfnNagLint'
        });
        documentSettings.set(resource, result);
    }
    return result;
}

documents.onDidClose(async (e) => {
    // connection.console.log('onDidClose');
    // Run one last validation in case the file was reverted on close
    const timer = documentTimers.get(e.document.uri);
    if (timer) {
        clearTimeout(timer);
        documentTimers.delete(e.document.uri);
    }

    await validateCloudFormationFile(e.document);
    documentSettings.delete(e.document.uri);
});

function convertSeverity(violationType: string): DiagnosticSeverity {
    switch (violationType) {
        case 'FAIL':
            return DiagnosticSeverity.Error;
        case 'WARN':
            return DiagnosticSeverity.Warning;
        default:
            return DiagnosticSeverity.Error;
    }
}

documents.onDidChangeContent((event) => {
    // connection.console.log('onDidChangeContent');
    const uri = event.document.uri;
    let timer = documentTimers.get(uri);

    if (timer) {
        clearTimeout(timer);
        documentTimers.delete(uri);
    }

    timer = setTimeout((e) => {
        validateCloudFormationFile(e.document);
    }, 1000, event);
    documentTimers.set(uri, timer);
});

async function validateCloudFormationFile(document: TextDocument): Promise<void> {
    // connection.console.log('validateCloudFormationFile');

    settings = await getDocumentSettings(document.uri);
    const uri = document.uri;

    // Don't validate if we're already doing that
    if (isValidating.get(uri)) {
        return;
    }

    isValidating.set(uri, true);

    const is_cfn_regex = new RegExp('"?AWSTemplateFormatVersion"?');
    let is_cfn = false;
    const text = document.getText();
    if (is_cfn_regex.exec(text)) {
        is_cfn = true;
    }

    connection.console.log('Is CFN: ' + is_cfn);

    if (is_cfn) {
        // First figure out which version of cfn_nag is installed
        const version = await getVersion(settings);

        const args = [];

        if (settings.debug) {
            connection.console.info(`Current cfn_nag version: ${version}`)
        }

        if (version) {
            // Only use the output-format parameter on versions 0.4.8 and onward.  Not supported earlier.
            var comparison = compareVersions(version, '0.4.8');
            if (settings.debug) {
                connection.console.info(`Version comparison = ${comparison}`);
            }
            if (comparison) {
                args.push('--output-format=json');
            }

            if (settings.conditionValuesPath != '') {
                // Only use the condition-values-path parameter on versions 0.4.73 and onware.  Not supported earlier.
                comparison = compareVersions(version, '0.4.73');
                if (settings.debug) {
                    connection.console.info(`Version comparison = ${comparison}`);
                }
                if (comparison) {
                    args.push(`--condition-values-path=${settings.conditionValuesPath}`);
                }
            }
        } else {
            // Couldn't determine version, so just assume the latest
            args.push('--output-format=json');
        }

        if (settings.allowSuppression) {
            args.push('--allow-suppression');
        }
        else {
            args.push('--no-allow-suppression');
        }

        if (settings.ruleDirectory != '') {
            args.push(`--rule-directory=${settings.ruleDirectory}`);
        }

        if (settings.profilePath != '') {
            args.push(`--profile-path=${settings.profilePath}`);
        }

        if (settings.parameterValuesPath != '') {
            args.push(`--parameter-values-path=${settings.parameterValuesPath}`);
        }

        if (settings.blacklistPath != '') {
            args.push(` --blacklist-path=${settings.blacklistPath}`);
        }

        if (settings.debug) {
            connection.console.info(`Running.....${settings.path} ${args}`);
        }

        const child = exec(settings.path + ' ' + args.join(' '), function (err: Error, stdout: string, stderr: string) {
            const diagnostics: Diagnostic[] = [];
            const filename = uri.toString();

            if (err) {
                if (settings.debug) {
                    connection.console.warn(`Error returned but ignored: ${err}`);
                }
            }

            if (stderr.length > 0) {
                connection.console.error(stderr);
                const diagnostic: Diagnostic = {
                    range: {
                        start: {
                            line: 0,
                            character: 0
                        },
                        end: {
                            line: 0,
                            character: Number.MAX_VALUE
                        }
                    },
                    severity: DiagnosticSeverity.Error,
                    message: stderr
                };
                diagnostics.push(diagnostic);

            } else if (stdout.length > 0) {
                if (settings.debug) {
                    connection.console.info(stdout);
                }

                const minSeverity = convertSeverity(settings.minimumProblemLevel);
                try {
                    const obj = JSON.parse(stdout);

                    let violations: any = null;
                    if (obj) {
                        if (isArray(obj)) {
                            if (obj[0].file_results && obj[0].file_results.violations) {
                                violations = obj[0].file_results.violations;
                            }
                        } else if (obj.violations) {
                            violations = obj.violations;
                        }
                    }

                    if (violations) {
                        for (let violation of violations) {
                            const severity = convertSeverity(violation.type);
                            if (severity <= minSeverity) {
                                if (!violation.logical_resource_ids) {
                                    const diagnostic: Diagnostic = {
                                        code: violation.id,
                                        message: violation.message,
                                        severity: severity,
                                        range: {
                                            start: {
                                                line: 0,
                                                character: 0
                                            },
                                            end: {
                                                line: 0,
                                                character: Number.MAX_VALUE
                                            }
                                        }
                                    };
                                    diagnostics.push(diagnostic);

                                } else {
                                    for (let resourceId of violation.logical_resource_ids) {
                                        // Let's try to find the position in the file where this resource id is located

                                        let resource_regex: RegExp;
                                        if (document.languageId == 'json') {
                                            resource_regex = new RegExp('"' + resourceId + '"(?=\\s*:)');

                                        } else if (document.languageId == 'yaml') {
                                            resource_regex = new RegExp('\\b' + resourceId + '(?=\\s*:)');
                                        }

                                        let start: Position;
                                        let end: Position;
                                        let message: string;

                                        const match = resource_regex.exec(text);
                                        if (match) {
                                            start = document.positionAt(match.index);
                                            end = document.positionAt(match.index + match[0].length);
                                            message = '(' + violation.id + ') ' + violation.message;
                                        } else {
                                            start = {
                                                line: 0,
                                                character: 0
                                            };
                                            end = {
                                                line: 0,
                                                character: Number.MAX_VALUE
                                            };
                                            message = '(' + violation.id + ') ' + resourceId + ': ' + violation.message;
                                        }

                                        const diagnostic: Diagnostic = {
                                            code: violation.id,
                                            message: message,
                                            severity: severity,
                                            range: {
                                                start: start,
                                                end: end
                                            }
                                        };
                                        diagnostics.push(diagnostic);
                                    }
                                }
                            }
                        }
                    }
                } catch (error) {
                    connection.console.warn(`Unexpected response from cfn_nag: ${stdout}`)
                }
            } else {
                connection.console.warn('No response returned from cfn_nag');
            }

            connection.sendDiagnostics({
                uri: filename,
                diagnostics
            });
            isValidating.delete(uri);
        });

        child.stdin.setDefaultEncoding('utf-8');
        child.stdin.write(text);
        child.stdin.end();
    }
}

async function getVersion(settings: CfnNagLintSettings): Promise<string> {

    return new Promise<string>(resolve => {
        if (settings.debug) {
            connection.console.log(`Running.....${settings.path} --version`);
        }

        exec(settings.path + ' --version', function (error: Error, stdout: string, stderr: string) {
            if (error) {
                if (settings.debug) {
                    connection.console.error('Error: ${error}');
                }
                resolve(null);
            } else if (stderr) {
                if (settings.debug) {
                    connection.console.error('Error: ${stderr}');
                }
                resolve(null);
            } else if (stdout) {
                resolve(stdout.trim());
            }
            else {
                if (settings.debug) {
                    connection.console.warn('No response returned.');
                }
                resolve(null);
            }
        });
    });
}

function compareVersions(version1: string, version2: string): number {

    const aVersion1 = version1.split('.');
    const aVersion2 = version2.split('.');

    for (let ix = 0; ix < aVersion1.length; ix++) {
        if (ix+1 > aVersion2.length) {
            return 1;
        } else {
            if (parseInt(aVersion1[ix]) > parseInt(aVersion2[ix])) {
                return 1;
            } else if (aVersion1[ix] < aVersion2[ix]) {
                return -1;
            }
        }
    }

    if (aVersion2.length > aVersion1.length) {
        return -1;
    }

    return 0;
}
documents.listen(connection);

connection.listen();