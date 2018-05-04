#!/usr/bin/env node

const Promise = require("bluebird");
const PATH = require("path");
const FS = require("fs-extra");
Promise.promisifyAll(FS);
FS.existsAsync = function (path) {
    return new Promise(function (resolve, reject) {
        try {
            return FS.exists(path, resolve);
        } catch (err) {
            return reject(err);
        }
    });
}
const LODASH = require("lodash");
const SPAWN = require("child_process").spawn;
const MINIMIST = require("minimist");
const RESOLVE = require("resolve");
const GET_PORT = require("get-port");
const DGRAM = require('dgram');
const UUID = require("uuid/v4");

const O_MSG_MULTICAST_ADDR = "224.1.1.1";


const DEBUG = false;

function loadLayersForBootRoot (bootCwd, bootOrigin) {

    if (DEBUG) console.log("loadLayersForBootRoot()", bootCwd, bootOrigin);
    
    var summary = Object.create({
        lookups: {}
    });
    LODASH.merge(summary, {
        boot: [],
        origins: {},
        layers: {}
    });

    summary.boot.push(bootOrigin);
    
    function forOriginRoot (cwd, origin, cwdStack) {
        cwdStack = cwdStack || [];

        if (DEBUG) console.log("\nforOriginRoot()", cwd, origin, cwdStack);

        function walkExtends (parentConfigPath, config) {
            if (!config["@extends"]) {
                return Promise.resolve(null);
            }
            if (DEBUG) console.log("walkExtends()", cwd, origin);
            
            var extendsOrigin = config["@extends"];
            delete config["@extends"];

            
            // If we are already extending from the same origin we
            // do not walk it again.
            if (
                summary.origins[config["@context"]] &&
                summary.origins[config["@context"]].extends &&
                summary.origins[config["@context"]].extends.indexOf(extendsOrigin) !== -1
            ) {
                if (DEBUG) console.log("SKIP walkExtends(): already exists");
                return Promise.resolve(null);
            }

            // If we are extending from the same origin as ourselves we ignore
            // recording it and only use it to traverse the origin being extended from.
            if (config["@context"] === extendsOrigin) {
                return forOriginRoot(PATH.join(parentConfigPath, "../../..", extendsOrigin), extendsOrigin);
            }

            summary.origins[config["@context"]] = summary.origins[config["@context"]] || {};            
            summary.origins[config["@context"]].extends = summary.origins[config["@context"]].extends || [];
            summary.origins[config["@context"]].extends.push(extendsOrigin);

            cwdStack = [].concat(cwdStack);
            cwdStack.push(cwd);


            return forOriginRoot(PATH.join(parentConfigPath, "../../..", extendsOrigin), extendsOrigin, cwdStack).then(function () {
                return forOriginRoot(cwd, extendsOrigin);
            }).then(function () {

                return Promise.mapSeries(cwdStack, function (cwd) {
                    return forOriginRoot(cwd, extendsOrigin);                
                });
            })
        }

        function nextFS (ownerOrigin, dir) {
            
            if (summary.lookups[origin + ":" + dir]) {
                return null;
            }

            var newDir = PATH.dirname(dir);
            if (newDir === dir) return null;

            summary.lookups[origin + ":" + dir] = true;
            
            return walkFS(ownerOrigin, newDir, true);
        }
        function walkFS (ownerOrigin, dir, allowMultipleContexts) {
            if (DEBUG) console.log("walkFS()", ownerOrigin, dir);

            var ownerOriginDir = dir;
            var path = PATH.join(dir, "o", origin + ".json");

            if (summary.lookups[origin + ":" + path]) {
                if (DEBUG) console.log("SKIP walkFS(): already loaded");
                return Promise.resolve(null);
            }
            summary.lookups[origin + ":" + path] = true;

            return FS.existsAsync(path).then(function (exists) {
                if (!exists) return nextFS(ownerOrigin, dir);                
                return FS.readFile(path, "utf8").then(function (config) {

                    config = config.replace(/\$\{__DIRNAME__\}/g, PATH.dirname(path));
                    config = JSON.parse(config);

                    if (Array.isArray(config)) {
                        if (!allowMultipleContexts) {
                            throw new Error("You cannot specify multiple contexts in high-level config file '" + path + "'!");
                        }
                        config.forEach(function (originConfig) {
                            if (originConfig["@extends"]) {
                                throw new Error("'@extends' not yet supported in high-level config file '" + path + "'! Can potentially be added.");
                            }

                            summary.origins[ownerOrigin] = summary.origins[ownerOrigin] || {};
                            summary.origins[ownerOrigin].configs = summary.origins[ownerOrigin].configs || {};
                            summary.origins[ownerOrigin].configs[originConfig["@context"]] = summary.origins[ownerOrigin].configs[originConfig["@context"]] || [];
                            summary.origins[ownerOrigin].configs[originConfig["@context"]].push({
                                path: path,
                                originRootPath: ownerOriginDir,
                                config: originConfig
                            });

                            delete originConfig["@context"];
                        });

                        return nextFS(ownerOrigin, dir);

                    } else {

                        if (!config["@context"]) {
                            throw new Error("[sourcelogic] No @context specified in config '" + path + "' where '" + origin + "' is expected!");
                        } else
                        if (config["@context"] !== origin) {
                            throw new Error("[sourcelogic] Found wrong @context of '" + config["@context"] + "' in config '" + path + "' where '" + origin + "' is expected!");
                        }

                        summary.origins[ownerOrigin] = summary.origins[ownerOrigin] || {};
                        summary.origins[ownerOrigin].configs = summary.origins[ownerOrigin].configs || {};
                        summary.origins[ownerOrigin].configs[config["@context"]] = summary.origins[ownerOrigin].configs[config["@context"]] || [];
                        summary.origins[ownerOrigin].configs[config["@context"]].push({
                            path: path,
                            originRootPath: ownerOriginDir,
                            config: config
                        });
    
                        return walkExtends(path, config).then(function () {
    
                            delete config["@context"];
                            
                            return nextFS(ownerOrigin, dir);
                        });
                    }
                });
            });
        }
        return walkFS(PATH.basename(cwd), cwd);
    }

    return forOriginRoot(bootCwd, bootOrigin).then(function () {

        // Collect all config into simple rOrigin grouped layers for easy merging.
        function walkOrigin (parentOrigin, origin) {
            if (summary.origins[origin].extends) {
                summary.origins[origin].extends.forEach(function (extendsOrigin) {
                    if (extendsOrigin !== parentOrigin) return;
                    walkOrigin(origin, extendsOrigin);
                });
            }
            if (summary.origins[origin].configs) {
                Object.keys(summary.origins[origin].configs).forEach(function (configOrigin) {
                    summary.layers[configOrigin] = summary.layers[configOrigin] || [];
                    for (var i=summary.origins[origin].configs[configOrigin].length-1; i>=0; i--) {
                        summary.layers[configOrigin].push(summary.origins[origin].configs[configOrigin][i]);
                    }
                });
            }
            if (summary.origins[origin].extends) {
                summary.origins[origin].extends.forEach(function (extendsOrigin) {
                    if (extendsOrigin === parentOrigin) return;
                    walkOrigin(origin, extendsOrigin);
                });
            }
        }
        summary.boot.forEach(function (origin) {
            walkOrigin(PATH.basename(bootCwd), origin);
        });
        // Prioritize config from working dir origin which should be the root boot context.
        walkOrigin(PATH.basename(bootCwd), PATH.basename(bootCwd));

        if (DEBUG) console.log("RETURN", "loadLayersForBootRoot()", JSON.stringify(summary, null, 4));

        return summary;
    });
}


function OriginWorkspace (cwd, rOrigin, options) {

    options = options || {};

    var self = this;

    self.layers = function () {
        return loadLayersForBootRoot(cwd, rOrigin);
    }
    
    self.config = function () {
        function mergeCustomizer (objValue, srcValue) {
            if (Array.isArray(objValue)) {
                var objValueId = {};
                objValue.forEach(function (value) {
                    objValueId[JSON.stringify(value)] = true;
                });
                var serialized = null;
                srcValue.forEach(function (value) {
                    serialized = JSON.stringify(value);
                    if (objValueId[serialized]) return;
                    objValueId[serialized] = true;
                    objValue.push(value);
                });
                return objValue;
            }
        }
        if (!self.config._config) {
            self.config._config = self.layers().then(function (summary) {
                var config = {
                    _layers: summary,
                    _rOrigin: rOrigin
                };

                Object.keys(summary.layers).forEach(function (origin) {
                    config[origin] = config[origin] || {};
                    for (var i=summary.layers[origin].length-1; i>=0; i--) {
                        LODASH.mergeWith(config[origin], summary.layers[origin][i].config, mergeCustomizer);                    
                    }
                });

                return config;
            });
        }
        return self.config._config;
    }

    self.exportConfig = function () {
        return self.config().then(function (config) {
            process.env.SOURCELOGIC_CONFIG = JSON.stringify(config, null, 4);
            return null;
        });
    }

    self.reExportConfig = function (config) {
        process.env.SOURCELOGIC_CONFIG = JSON.stringify(config, null, 4);
    }

    function onBroadcastMessage (message) {
        
    }

    function ensureMessageListener (O_MSG_PORT) {
        if (!ensureMessageListener._listener) {
            ensureMessageListener._listener = GET_PORT().then(function (port) {

                self.broadcastMessage = function (message) {

                    return new Promise(function (resolve, reject) {
            
                        var key = Object.keys(message)[0];
                        var msg = {};
                        msg[key.replace(/@/, "@" + self.config._config._rOrigin + "/")] = message[key];
                                    
                        message = Buffer.from(JSON.stringify(msg));
            
                        var sender = DGRAM.createSocket({
                            type: "udp4",
                            reuseAddr: true
                        });
                        sender.send(message, 0, message.length, O_MSG_PORT || port, O_MSG_MULTICAST_ADDR, function (err) {
                            if (err) return reject(err);
                            sender.close();
                            return resolve(null);
                        });
                        sender.unref();
                    });
                }

                return new Promise(function (resolve, reject) {

                    const listener = DGRAM.createSocket({
                        type: "udp4",
                        reuseAddr: true
                    });

                    listener.on('error', (err) => {
                        listener.close();
                        reject(err);
                    });
                    
                    listener.on('message', (msg, rinfo) => {
                        onBroadcastMessage(JSON.parse(msg));
                    });

                    listener.on('listening', () => {
                        resolve(listener.address());
                    });

                    listener.bind(O_MSG_PORT || port, O_MSG_MULTICAST_ADDR, function() {
                        listener.addMembership(O_MSG_MULTICAST_ADDR);
                        listener.setBroadcast(true);
                    });
                    listener.unref();
                });
            });
        }
        return ensureMessageListener._listener;
    }

    self.spawn = function (cmd, args, opts) {

        return self.config().then(function (config) {

            opts.env = LODASH.merge({}, process.env, opts.env);                    
            
            const O_MSG_PORT = "O_MSG_PORT_" + config["foundation.workspace"].instance.id;
            
            return ensureMessageListener(
                (O_MSG_PORT && opts.env[O_MSG_PORT]) || null
            ).then(function (address) {

                return new Promise(function (resolve) {

                    opts.env[O_MSG_PORT] = address.port;

                    return resolve(SPAWN(cmd, args, opts));
                });
            });
        });            
    };
}


exports.forOriginWorkspace = function (cwd, rOrigin, options) {
return new OriginWorkspace(cwd, rOrigin, options);
    var key = cwd + ":" + rOrigin + ":" + JSON.stringify(options);
    if (!exports.forOriginWorkspace._cache[key]) {
        exports.forOriginWorkspace._cache[key] = new OriginWorkspace(cwd, rOrigin, options);
    }
    return exports.forOriginWorkspace._cache[key];
}
exports.forOriginWorkspace._cache = {};



function OriginContext (SOURCELOGIC_CONFIG, rootId) {
    var self = this;

    self.CONFIG = SOURCELOGIC_CONFIG;

    // TODO: Instead of assuming 'instance.id' here use namespace/JSON-LD based lookup
    //       to find value for 'org.pinf/manifest'.instance.id'
    self.instanceId = SOURCELOGIC_CONFIG[rootId].instance.id;


    // TODO: Instead of assuming 'components.node_modules' here use namespace/JSON-LD based lookup
    //       to find value for 'org.pinf.it.org.nodejs/opts'.modules.node_modules'
    const paths = [].concat(SOURCELOGIC_CONFIG[rootId].components.node_modules);
    self.require = function (uri) {
        var path = RESOLVE.sync(uri, {
            basedir: process.cwd(),
            paths: paths.concat(PATH.join(process.cwd(), ".."))
        });
//            throw new Error("Package with alias '" + id + "' not found!");
        return require(path);
    }


    const O_MSG_PORT = "O_MSG_PORT_" + self.instanceId;
    if (!process.env[O_MSG_PORT]) {
        throw new Error("Cannot send UDP message as 'process.env." + O_MSG_PORT + "' is not set!");
    }

    self.broadcastMessage = function (message) {
        return new Promise(function (resolve, reject) {

            var key = Object.keys(message)[0];
            var msg = {};
            msg[key.replace(/@/, "@" + self.CONFIG._rOrigin + "/")] = message[key];

            message = Buffer.from(JSON.stringify(msg));

            var sender = DGRAM.createSocket({
                type: "udp4",
                reuseAddr: true
            });
            sender.send(message, 0, message.length, parseInt(process.env[O_MSG_PORT]), O_MSG_MULTICAST_ADDR, function (err) {
                if (err) return reject(err);
                sender.close();
                return resolve(null);
            });
            sender.unref();
        });            
    }


    var on = {};
    self.on = function (id, handler) {
        if (!on[id]) {
            on[id] = [];
        }
        return new Promise(function (resolve) {
            on[id].push([handler, resolve]);
        });
    };

    var msgRe = new RegExp("^@" + self.CONFIG._rOrigin + "\\/(.+)$");
    function onBroadcastMessage (message) {
        var keys = Object.keys(message);
        var newValues = {};
        var m;
        keys.forEach(function (key) {
            m = key.match(msgRe);
            if (m) {
                newValues["@" + m[1]] = message[key];
            }
        });
        if (!Object.keys(newValues).length) {
            return;
        }
        LODASH.merge(SOURCELOGIC_CONFIG, newValues);
        var id = Object.keys(newValues)[0];
        if (on[id]) {
            try {
                on[id].forEach(function (handler) {
                    // resolve once
                    Promise.try(function () {
                        return handler[1](newValues[id]);
                    }).catch(function (err) {
                        throw err;
                    });
                    // always fire event
                    if (handler[0]) {
                        Promise.try(function () {
                            return handler[0](newValues[id]);
                        }).catch(function (err) {
                            throw err;
                        });
                    }
                });
            } catch (err) {
                console.error("Error boradcasting message", message);
                throw err;
            }
        }
    }

    function ensureMessageListener () {
        if (!ensureMessageListener._listener) {
            ensureMessageListener._listener = new Promise(function (resolve, reject) {

                const listener = DGRAM.createSocket({
                    type: "udp4",
                    reuseAddr: true
                });

                listener.on('error', (err) => {
                    listener.close();
                    reject(err);
                });
                
                listener.on('message', (msg, rinfo) => {
                    onBroadcastMessage(JSON.parse(msg));
                });

                listener.on('listening', () => {
                    resolve(null);
                });

                listener.bind(parseInt(process.env[O_MSG_PORT]), O_MSG_MULTICAST_ADDR, function() {
                    listener.addMembership(O_MSG_MULTICAST_ADDR);
                    listener.setBroadcast(true);
                });
                listener.unref();                
            });                
        }
        return ensureMessageListener._listener;
    }

    self.ready = ensureMessageListener().then(function () {
        return null;
    });
}


exports.init = function (rootId) {
    if (!process.env.SOURCELOGIC_CONFIG) {
        throw new Error("Cannot init sourcelogic context as 'process.env.SOURCELOGIC_CONFIG' is not set!");
    }
    return new OriginContext(JSON.parse(process.env.SOURCELOGIC_CONFIG), rootId);
}


exports.resolve = function (id) {
    var idParts = id.split("/");
    var packagePath = PATH.join(process.cwd(), "..", idParts.shift());
    return PATH.join(packagePath, idParts.join("/"));    
}

exports.require = function (uri) {
    return require(uri);
}


if (require.main === module) {

    const originalEnv = LODASH.merge({}, process.env);

    const npm_config_argv = JSON.parse(process.env.npm_config_argv || "{}");
    npm_config_argv.original = npm_config_argv.original || [];

    const argv = MINIMIST(process.argv.slice(2).concat(npm_config_argv.original.slice(1)));
    
    const cwd = process.cwd();
    var rOrigin = PATH.basename(cwd);

    if (!argv._[0]) {
        throw new Error("[sourcelogic] No command to run specified!");
    }
    if (/^\//.test(argv._[0])) {
        throw new Error("[sourcelogic] Command must be a relative path!");
    }
    var commands = null;
    var property = null;
    var options = {
//        bootrOrigin: null
    };
    if (/^\./.test(argv._[0])) {
        commands = PATH.join(cwd, argv._[0]);
    } else
    if (/^[^\/]+\/[^\/]+$/.test(argv._[0])) {
        var parts = argv._[0].split("/");
//        options.bootrOrigin = parts[0];
        process.env.SOURCELOGIC_CONFIG_ORIGIN = parts[0];
        property = parts[1];
    } else {
        property = argv._[0];
    }

    if (process.env.SOURCELOGIC_CONFIG_ORIGIN) {
        rOrigin = process.env.SOURCELOGIC_CONFIG_ORIGIN;
    }

    function forOriginDir (cwd, rOrigin) {

console.log("START", cwd, rOrigin);

        var o = exports.forOriginWorkspace(cwd, rOrigin, options);

        Promise.try(function () {
    
            if (argv.layers) {
                return o.layers().then(function (layers) {

                    // TODO: Do not display 'AWS_SECRET_ACCESS_KEY' and other sensitive variables
                    process.stdout.write(JSON.stringify(layers, null, 4));
                    return null;
                });
            }
    
            return o.config().then(function (config) {

                if (
                    config['org.sourcelogic'] &&
                    config['org.sourcelogic'].origins
                ) {
                    config['org.sourcelogic'].origins.forEach(function (origin) {
                        if (origin === rOrigin) {
                            // ignore self as we have already started it
                            return;
                        }

console.log("origin", cwd, origin, "RUN!!!!", __dirname, process.argv.slice(2));

                        //forOriginDir(origin);
//                        forOriginDir(PATH.join(cwd, "..", origin), origin);

                        o.spawn(__filename, process.argv.slice(2), {
                            stdio: [
                                process.stdin,
                                'pipe',
                                'inherit'
                            ],
                            cwd: PATH.join(cwd, "..", origin),
                            env: originalEnv
                        }).then(function (proc) {
                            return new Promise(function (resolve, reject) {
                                proc.stdout.on("data", function (chunk) {
                                    process.stdout.write(chunk);
                                    chunk = chunk.toString();
                                    var re = /\[sourcelogic\]\[set\]\s([^=]+)\s=\s(.+)\n/g;
                                    var m;
                                    while (m = re.exec(chunk)) {

console.log("MESSAGE FROM SUB-LAYER", m);

                                        LODASH.set(config, m[1], m[2]);
                                        o.reExportConfig(config);

                                        var propertyPath = LODASH.toPath(m[1]);
                                        var message = {};
                                        message["@" + propertyPath.shift()] = LODASH.set({}, propertyPath, m[2]);
                                        o.broadcastMessage(message);
                                    }
                                });
                                proc.on("error", reject);
                                proc.on("close", resolve);
                            });
                        }).catch(function (err) {
                            console.error(err);
                            process.exit(1);
                        });

                    });
                }
    
                o.reExportConfig(config);
    
                if (argv.config) {
                    // TODO: Do not display 'AWS_SECRET_ACCESS_KEY' and other sensitive variables
                    process.stdout.write(process.env.SOURCELOGIC_CONFIG);
                    return null;
                }
      
                if (
                    npm_config_argv &&
                    npm_config_argv.original &&
                    npm_config_argv.original.indexOf("--verbose") !== -1
                ) {
                    process.env.VERBOSE = 1;
                }
    
                // Put some utility commands on the path
                process.env.PATH = (PATH.join(__dirname, "node_modules/.bin") + ":" + process.env.PATH);
                process.env.NODE_PATH = (PATH.join(__dirname, "node_modules") + ":" + process.env.NODE_PATH);
    
                function run (path) {
    
                    var args = process.argv.slice(3).concat(npm_config_argv.original.slice(1));
                    console.error("[sourcelogic] Run command:", path, args, cwd);
    
                    return o.spawn(path, args, {
                        stdio: [
                            process.stdin,
                            'pipe',
                            'inherit'
                        ],
                        cwd: cwd
                    }).then(function (proc) {
                        return new Promise(function (resolve, reject) {
                            proc.stdout.on("data", function (chunk) {
                                process.stdout.write(chunk);
                                chunk = chunk.toString();
                                var re = /\[sourcelogic\]\[set\]\s([^=]+)\s=\s(.+)\n/g;
                                var m;
                                while (m = re.exec(chunk)) {
    
                                    LODASH.set(config, m[1], m[2]);
                                    o.reExportConfig(config);
    
                                    var propertyPath = LODASH.toPath(m[1]);
                                    var message = {};
                                    message["@" + propertyPath.shift()] = LODASH.set({}, propertyPath, m[2]);
                                    o.broadcastMessage(message);
                                }
                            });
                            proc.on("error", reject);
                            proc.on("close", resolve);
                        });
                    });
                }
    
                if (!commands && property) {
                    return Promise.mapSeries(property.split(","), function (property) {
                        commands = [];
    
                        property = property.replace(/\[([^\]]+)\]/g, "['$1']");
    
                        if (!LODASH.has(config, property)) {
                            throw new Error("[sourcelogic] Cannot run command at property path '" + property + "' for cwd '" + cwd + "' and rOrigin '" + rOrigin + "' because property does not exist in referenced 'o/' config files.");
                        }
                        commands = LODASH.get(config, property);
                        if (!Array.isArray(commands)) {
                            commands = [ commands ];
                        }
    
                        return Promise.mapSeries(commands, function (command) {
                            return run(command).then(function (code) {
                                if (code !== 0) {
                                    console.error('[sourcelogic] Error running command:', command);
                                    throw new Error("[sourcelogic] Command exited with status: " + code);
                                }
                                return null;
                            });
                        });
                    });
                }
                return Promise.mapSeries(commands, run);
            });
    
        }).catch(function (err) {
            console.error(err.stack);
            process.exit(1);
        });        

    }

    forOriginDir(cwd, rOrigin);
}
