'use strict';

import {
    createConnection,
    TextDocuments,
    TextDocument,
    Diagnostic,
    DiagnosticSeverity,
    ProposedFeatures,
    IConnection,
    InitializeResult,
    Position,
    InitializeParams,
    DidChangeConfigurationNotification
} from 'vscode-languageserver';

import { spawn } from 'child_process';

const connection: IConnection = createConnection(ProposedFeatures.all);

const documents: TextDocuments = new TextDocuments();

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;

connection.onInitialize((params: InitializeParams): InitializeResult => {
    const capabilities = params.capabilities;
    hasConfigurationCapability = capabilities.workspace && !!capabilities.workspace.configuration;
    hasWorkspaceFolderCapability = capabilities.workspace && !!capabilities.workspace.workspaceFolders;

    return {
        capabilities: {
            textDocumentSync: documents.syncKind
        }
    };
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
}

const defaultSettings: CfnNagLintSettings = {
    path: 'cfn_nag',
    parameterValuesPath: '',
    profilePath: '',
    ruleDirectory: '',
    minimumProblemLevel: 'WARN',
    allowSuppression: true
};

let globalSettings: CfnNagLintSettings = defaultSettings;
let documentSettings: Map<string, Thenable<CfnNagLintSettings>> = new Map();
let documentTimers: Map<string, NodeJS.Timer> = new Map();
let isValidating: Map<string, boolean> = new Map();

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

    let settings = await getDocumentSettings(document.uri);
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
        // const file_to_lint = Files.uriToFilePath(document.uri);
        // const args = ['--output-format=json', '--input-path=' + file_to_lint];

        const args = [];

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

        connection.console.log(`Running.....${settings.path} ${args}`);

        const child = spawn(settings.path, args, { shell: true });

        const diagnostics: Diagnostic[] = [];
        const filename = uri.toString();

        child.on('error', function (err) {
            const errorMessage = `Unable to start cfn_nag (${err}).  Is cfn_nag installed correctly?`;
            connection.console.log(errorMessage);

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
                message: errorMessage
            };
            diagnostics.push(diagnostic);
        });

        child.stderr.on('data', (data: Buffer) => {
            // connection.console.log(`Received output on stderr: ${data}`);
            const err = data.toString();
            connection.console.log(err);
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
                message: err
            };
            diagnostics.push(diagnostic);
        });

        let stdout = '';
        child.stdout.on('data', (data: Buffer) => {
            stdout = stdout.concat(data.toString());
        });

        child.on('exit', function (code, signal) {
            connection.console.log(`Child process exited with code ${code} and signal ${signal}`);
            const tmp = stdout.toString();
            if (tmp.length > 0) {
                const minSeverity = convertSeverity(settings.minimumProblemLevel);
                try {

                    const obj = JSON.parse(tmp);

                    if (obj && obj.violations) {
                        for (let violation of obj.violations) {
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
                    connection.console.warn(`Unexpected response from cfn-nag: ${tmp}`)
                }
            }
        });

        child.on('close', () => {
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

documents.listen(connection);

connection.listen();