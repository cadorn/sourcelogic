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


var DEBUG = false;

function loadLayersForBootRoot (bootCwd, bootOrigin) {

    if (DEBUG) console.error("loadLayersForBootRoot()", bootCwd, bootOrigin);
    
    var summary = Object.create({
        lookups: {}
    });
    LODASH.merge(summary, {
        boot: [],
        origins: {},
        layers: {},
        subOrigins: {}
    });

    summary.boot.push(bootOrigin);
    
    function forOriginRoot (summary, cwd, origin, cwdStack, skipWalkFS) {
        cwdStack = cwdStack || [];

        if (DEBUG) console.error("\nforOriginRoot()", cwd, origin, cwdStack, skipWalkFS);

        function walkExtends (parentConfigPath, config, skipWalkFS) {
            if (!config["@extends"]) {
                return Promise.resolve(null);
            }
            if (DEBUG) console.error("walkExtends()", cwd, origin);
            
            var extendsOrigin = config["@extends"];
            delete config["@extends"];

            
            // If we are already extending from the same origin we
            // do not walk it again.
            if (
                summary.origins[config["@context"]] &&
                summary.origins[config["@context"]].extends &&
                summary.origins[config["@context"]].extends.indexOf(extendsOrigin) !== -1
            ) {
                if (DEBUG) console.error("SKIP walkExtends(): already exists");
                return Promise.resolve(null);
            }

            // If we are extending from the same origin as ourselves we ignore
            // recording it and only use it to traverse the origin being extended from.
            if (config["@context"] === extendsOrigin) {
                return forOriginRoot(summary, PATH.join(parentConfigPath, "../../..", extendsOrigin), extendsOrigin, [], skipWalkFS);
            }

            summary.origins[config["@context"]] = summary.origins[config["@context"]] || {};            
            summary.origins[config["@context"]].extends = summary.origins[config["@context"]].extends || [];
            summary.origins[config["@context"]].extends.push(extendsOrigin);

            cwdStack = [].concat(cwdStack);
            cwdStack.push(cwd);


            return forOriginRoot(summary, PATH.join(parentConfigPath, "../../..", extendsOrigin), extendsOrigin, cwdStack).then(function () {
                return forOriginRoot(summary, cwd, extendsOrigin, [], skipWalkFS);
            }).then(function () {

                return Promise.mapSeries(cwdStack, function (cwd) {
                    return forOriginRoot(summary, cwd, extendsOrigin, [], skipWalkFS);                
                });
            })
        }

        function nextFS (ownerOrigin, dir, skipWalkFS) {
            
            if (summary.lookups[origin + ":" + dir]) {
                return null;
            }

            var newDir = PATH.dirname(dir);
            if (newDir === dir) return null;

            summary.lookups[origin + ":" + dir] = true;
            
            return walkFS(ownerOrigin, newDir, skipWalkFS);
        }
        function walkFS (ownerOrigin, dir, skipWalkFS) {
            if (DEBUG) console.error("walkFS()", ownerOrigin, dir);

            var ownerOriginDir = dir;
            var path = PATH.join(dir, "o", origin + ".json");

            if (summary.lookups[origin + ":" + path]) {
                if (DEBUG) console.error("SKIP walkFS(): already loaded");
                return Promise.resolve(null);
            }
            summary.lookups[origin + ":" + path] = true;

            return FS.existsAsync(path).then(function (exists) {
                if (!exists) {
                    if (skipWalkFS) {
                        return null;
                    }
                    return nextFS(ownerOrigin, dir);
                }
                return FS.readFile(path, "utf8").then(function (config) {

                    config = config.replace(/\$\{__DIRNAME__\}/g, PATH.dirname(path));
                    config = JSON.parse(config);

                    if (Array.isArray(config)) {
//                        if (!allowMultipleContexts) {
//                            throw new Error("You cannot specify multiple contexts in high-level config file '" + path + "'!");
//                        }
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

                        if (skipWalkFS) {
                            return null;
                        }
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
    
                        return walkExtends(path, config, skipWalkFS).then(function () {
    
                            delete config["@context"];

                            if (skipWalkFS) {
                                return null;
                            }
                            return nextFS(ownerOrigin, dir);
                        });
                    }
                });
            });
        }
        return walkFS(PATH.basename(cwd), cwd, skipWalkFS);
    }

    function forSubOrigins (subOrigins) {

        return Promise.map(subOrigins, function (subOrigin) {

            var subOriginSummary = Object.create({
                lookups: {}
            });
            LODASH.merge(subOriginSummary, {
                boot: [],
                origins: {},
                layers: {}
            });
        
            return forOriginRoot(subOriginSummary, bootCwd, subOrigin, [], true).then(function () {

                if (subOriginSummary.origins[bootOrigin]) {
                    var config = {};
                    Object.keys(subOriginSummary.origins[bootOrigin].configs).forEach(function (origin) {
                        config[origin] = config[origin] || {};
                        for (var i=subOriginSummary.origins[bootOrigin].configs[origin].length-1; i>=0; i--) {
                            LODASH.mergeWith(config[origin], subOriginSummary.origins[bootOrigin].configs[origin][i].config, mergeCustomizer);                    
                        }
                    });
                    summary.subOrigins[subOrigin] = config;
                }

                return Promise.resolve(null);        
            });
        });
    }

    return forOriginRoot(summary, bootCwd, bootOrigin).then(function () {

        var subOrigins = [];

        // Collect all config into simple rOrigin grouped layers for easy merging.
        function walkOrigin (parentOrigin, origin) {
            if (!summary.origins[origin]) {
                return;
            }
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
            
            if (
                summary.origins[origin] &&
                summary.origins[origin].configs &&
                summary.origins[origin].configs['org.sourcelogic']
            ) {
                summary.origins[origin].configs['org.sourcelogic'].forEach(function (layer) {
                    subOrigins = subOrigins.concat(layer.config.origins);
                });
            }                
        }
        summary.boot.forEach(function (origin) {
            walkOrigin(PATH.basename(bootCwd), origin);
        });
        // Prioritize config from working dir origin which should be the root boot context.
        walkOrigin(PATH.basename(bootCwd), PATH.basename(bootCwd));

        if (DEBUG) console.error("RETURN", "loadLayersForBootRoot()", JSON.stringify(summary, null, 4));

        subOrigins = LODASH.uniq(subOrigins);

        return forSubOrigins(subOrigins).then(function () {

            return summary;
        });
    });
}


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

function condenseLayers (rOrigin, summary) {

    var config = Object.create({
        _layers: summary
    });
    config._rOrigin = rOrigin;
    Object.keys(summary.layers).forEach(function (origin) {
        config[origin] = config[origin] || {};
        for (var i=summary.layers[origin].length-1; i>=0; i--) {
            LODASH.mergeWith(config[origin], summary.layers[origin][i].config, mergeCustomizer);                    
        }
    });

    Object.keys(summary.subOrigins).forEach(function (subOrigin) {
        if (config[subOrigin]) {
            throw new Error("Sub-origin '" + subOrigin + "' should not already exist in config!");
        }
        config[subOrigin] = summary.subOrigins[subOrigin];
    });

    return config;
}


function OriginWorkspace (cwd, rOrigin, options) {
    
    if (process.env.VERBOSE) console.error("[sourcelogic] OriginWorkspace()", cwd, rOrigin, options);

    options = options || {};

    const self = this;

    self.layers = function () {
        return loadLayersForBootRoot(cwd, rOrigin);
    }

    self.config = function () {
        if (!self.config._config) {
            self.config._config = self.layers().then(function (summary) {
                var config = condenseLayers(rOrigin, summary);

                LODASH.mergeWith(config, JSON.parse(process.env.SOURCELOGIC_CONFIG_OVERLAY || "{}"), mergeCustomizer);

                return config;
            });
        }
        return self.config._config;
    }

    self.exportConfig = function () {
        return self.config().then(function (config) {
            process.env.SOURCELOGIC_LAYERS = JSON.stringify(config._layers, null, 4);
            process.env.SOURCELOGIC_CONFIG = JSON.stringify(config, null, 4);
            return null;
        });
    }

    self.reExportConfig = function (config) {
        process.env.SOURCELOGIC_LAYERS = JSON.stringify(config._layers, null, 4);
        process.env.SOURCELOGIC_CONFIG = JSON.stringify(config, null, 4);
    }


    function onBroadcastMessage (message) {
        
    }

    function ensureMessageListener (O_MSG_PORT) {
        if (!ensureMessageListener._listener) {

            function getMessagePort () {
                if (O_MSG_PORT) {
                    return Promise.resolve(parseInt(O_MSG_PORT));
                }
                return GET_PORT();                
            }

            ensureMessageListener._listener = getMessagePort().then(function (port) {

                self.broadcastMessage = function (message) {

                    return self.config._config.then(function (config) {

                        return new Promise(function (resolve, reject) {
                
                            var key = Object.keys(message)[0];
                            var msg = {};
                            msg[key.replace(/@/, "@" + config._rOrigin + "/")] = message[key];

                            if (process.env.VERBOSE) console.error("[sourcelogic] Broadcast message:", msg, "(from: " + rOrigin + ")");

                            message = Buffer.from(process.env.O_CID + ":" + JSON.stringify(msg));
                
                            var sender = DGRAM.createSocket({
                                type: "udp4",
                                reuseAddr: true
                            });
                            sender.send(message, 0, message.length, port, O_MSG_MULTICAST_ADDR, function (err) {
                                if (err) return reject(err);
                                sender.close();
                                return resolve(null);
                            });
                            sender.unref();
                        });
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
/*
                        var m = msg.toString().match(/^([^:]+):(.+)$/);
                        if (!m) {
                            console.error("msg", msg);
                            throw new Error("UDP message has invalid format!");
                        }
    
                        var msg = JSON.parse(m[2]);
                        var key = Object.keys(msg)[0];
                        var keyM = key.match(/^@([^\/]+)\/(.+)$/);

                        if (
                            keyM[1] === rOrigin
                        ) {
console.error("     --- MESSAGE IN WORKSPACE", key, keyM[1], keyM[2], msg, rOrigin);
                        }
*/
//                        onBroadcastMessage(JSON.parse(msg));
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

            opts.env = LODASH.merge({}, opts.env || process.env);

            return ensureMessageListener(
                opts.env.O_MSG_PORT || null
            ).then(function (address) {

                return new Promise(function (resolve) {

                    opts.env.O_MSG_PORT = address.port;
                    opts.env.O_CID = opts.env.O_CID || ("O_CID_" + UUID());

                    var proc = SPAWN(cmd, args, opts);
                    proc.O_CID = opts.env.O_CID;

                    return resolve(proc);
                });
            });
        });            
    };
}


exports.forOriginWorkspace = function (cwd, rOrigin, options) {

    return new OriginWorkspace(cwd, rOrigin, options);
    /*
    var key = cwd + ":" + rOrigin + ":" + JSON.stringify(options);
    if (!exports.forOriginWorkspace._cache[key]) {
        exports.forOriginWorkspace._cache[key] = new OriginWorkspace(cwd, rOrigin, options);
    }
    return exports.forOriginWorkspace._cache[key];
    */
}
exports.forOriginWorkspace._cache = {};



function OriginContext (SOURCELOGIC_LAYERS, SOURCELOGIC_CONFIG, rootId) {
    var self = this;

    if (process.env.VERBOSE) console.error("[sourcelogic] OriginContext()", rootId);

    self.LAYERS = SOURCELOGIC_LAYERS;
    self.CONFIG = SOURCELOGIC_CONFIG;

    // TODO: Instead of assuming 'instance.id' here use namespace/JSON-LD based lookup
    //       to find value for 'org.pinf/manifest'.instance.id'
//    self.instanceId = SOURCELOGIC_CONFIG[rootId].instance.id;


    // TODO: Instead of assuming 'components.node_modules' here use namespace/JSON-LD based lookup
    //       to find value for 'org.pinf.it.org.nodejs/opts'.modules.node_modules'
    const paths = (
        self.CONFIG[rootId] &&
        self.CONFIG[rootId].components &&
        [].concat(self.CONFIG[rootId].components.node_modules)
    ) || [];
    self.require = function (uri) {
        var path = RESOLVE.sync(uri, {
            basedir: process.cwd(),
            paths: paths.concat(PATH.join(process.cwd(), ".."))
        });
//            throw new Error("Package with alias '" + id + "' not found!");
        return require(path);
    }


    if (!process.env.O_CID) {
        throw new Error("Cannot send/receive UDP message as 'process.env.O_CID' is not set!");
    }
    if (!process.env.O_MSG_PORT) {
        throw new Error("Cannot send/receive UDP message as 'process.env.O_MSG_PORT' is not set!");
    }

    self.broadcastMessage = function (message) {
        return new Promise(function (resolve, reject) {

            var key = Object.keys(message)[0];
            var keyM = key.match(/^([^@]+)?@(.+)$/);
            var msg = {};
            var broadcastKey = null;
            var targetCid = null;
            if (keyM[1]) {
                if (
                    !self.CONFIG["org.sourcelogic"] ||
                    !self.CONFIG["org.sourcelogic"].origins$[keyM[1]]
                ) {
                    throw new Error("Cannot send message to origin '" + keyM[1] + "' because it is not declared/running!");
                }
                targetCid = self.CONFIG["org.sourcelogic"].origins$[keyM[1]].O_CID;
                broadcastKey = ("@" + keyM[1] + "/" + keyM[2]);
            } else {
                targetCid = process.env.O_CID;
                broadcastKey = ("@" + self.CONFIG._rOrigin + "/" + keyM[2]);
            }
            msg[broadcastKey] = message[key];

            message = Buffer.from(targetCid + ":" + JSON.stringify(msg));

            var sender = DGRAM.createSocket({
                type: "udp4",
                reuseAddr: true
            });
            if (process.env.VERBOSE) console.error("[sourcelogic][" + self.CONFIG._rOrigin + "] Send message to:", process.env.O_CID, parseInt(process.env.O_MSG_PORT), O_MSG_MULTICAST_ADDR, Object.keys(msg)[0]);
            sender.send(message, 0, message.length, parseInt(process.env.O_MSG_PORT), O_MSG_MULTICAST_ADDR, function (err) {
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

    function onBroadcastMessage (id, message) {

        if (process.env.VERBOSE) console.error("[sourcelogic][" + self.CONFIG._rOrigin + "] Received message from:", parseInt(process.env.O_MSG_PORT), O_MSG_MULTICAST_ADDR, "for", id);

        var newValues = {};
        newValues[":" + id.replace(/^@/, "")] = message;

        LODASH.mergeWith(self.CONFIG, newValues, function (objValue, srcValue) {
            if (LODASH.isArray(objValue)) {
                return objValue.concat(srcValue);
            }
        });

        process.env.SOURCELOGIC_CONFIG = JSON.stringify(self.CONFIG, null, 4);

        if (process.env.VERBOSE) console.error("[sourcelogic][" + self.CONFIG._rOrigin + "] Handle message for", id, "using handlers", Object.keys(on));
        
        if (on[id]) {
            try {
                on[id].forEach(function (handler) {
                    // resolve once
                    Promise.try(function () {
                        return handler[1](message);
                    }).catch(function (err) {
                        throw err;
                    });
                    // always fire event
                    if (handler[0]) {
                        Promise.try(function () {
                            return handler[0](message);
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
                
                /*
                var originsByCid = {};
                if (
                    self.CONFIG["org.sourcelogic"] &&
                    self.CONFIG["org.sourcelogic"].origins$
                ) {
                    Object.keys(self.CONFIG["org.sourcelogic"].origins$).forEach(function (name) {
                        originsByCid[self.CONFIG["org.sourcelogic"].origins$[name].O_CID] = name;
                    });
                }
                */

                listener.on('message', (msg, rinfo) => {
                    var m = msg.toString().match(/^([^:]+):(.+)$/);
                    if (!m) {
                        console.error("msg", msg);
                        throw new Error("UDP message has invalid format!");
                    }

                    var msg = JSON.parse(m[2]);
                    var key = Object.keys(msg)[0];
                    var keyM = key.match(/^@([^\/]+)\/(.+)$/);

                    if (
                        m[1] === process.env.O_CID &&
                        keyM[1] === self.CONFIG._rOrigin
                    ) {
                        onBroadcastMessage("@" + keyM[2], msg[key]);
                    } else
                    /*
                    if (
                        originsByCid[m[1]] &&
                        keyM[1] === originsByCid[m[1]]
                    ) {
                        onBroadcastMessage(keyM[1] + "@" + keyM[2], msg[key]);                        
                    } else
                    */
                    if (
                        self.CONFIG["org.sourcelogic"] &&
                        self.CONFIG["org.sourcelogic"].origins &&
                        self.CONFIG["org.sourcelogic"].origins.indexOf(keyM[1]) !== -1
                    ) {
                        onBroadcastMessage(keyM[1] + "@" + keyM[2], msg[key]);                        
                    }
                });

                listener.on('listening', () => {
                    resolve(null);
                });

                if (process.env.VERBOSE) console.error("[sourcelogic][" + self.CONFIG._rOrigin + "] Listening to messages from:", parseInt(process.env.O_MSG_PORT), O_MSG_MULTICAST_ADDR);

                listener.bind(parseInt(process.env.O_MSG_PORT), O_MSG_MULTICAST_ADDR, function() {
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
    if (!process.env.SOURCELOGIC_LAYERS) {
        throw new Error("Cannot init sourcelogic context as 'process.env.SOURCELOGIC_LAYERS' is not set!");
    }
    if (!process.env.SOURCELOGIC_CONFIG) {
        throw new Error("Cannot init sourcelogic context as 'process.env.SOURCELOGIC_CONFIG' is not set!");
    }
    return new OriginContext(
        JSON.parse(process.env.SOURCELOGIC_LAYERS),
        JSON.parse(process.env.SOURCELOGIC_CONFIG),
        rootId
    );
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

    if (argv.debug) {
        DEBUG = true;
    }
    if (argv.verbose) {
        delete argv.silent;
        process.env.VERBOSE = "1";
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

    process.env.O_CID = process.env.O_CID || ("O_CID_" + UUID());

    function forOriginDir (cwd, rOrigin) {

        if (argv.verbose) console.error("[sourcelogic] forOriginDir:", cwd, rOrigin);

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

                // TODO: Relocate to 'o.runOrigins()'
                function runOrigins () {
                    if (
                        argv['skip-run-origins'] ||
                        !config['org.sourcelogic'] ||
                        !config['org.sourcelogic'].origins
                    ) {
                        return Promise.resolve(null);
                    }

                    var originMeta = {};
                    return Promise.map(config['org.sourcelogic'].origins, function (origin) {
                        if (origin === rOrigin) {
                            // ignore self as we have already started it
                            return null;
                        }

                        if (argv.verbose) console.error("[sourcelogic] Run origin:", PATH.join(cwd, "..", origin), process.argv.slice(2));

                        //forOriginDir(origin);
//                        forOriginDir(PATH.join(cwd, "..", origin), origin);

                        return new Promise(function (resolve) {

                            o.spawn(__filename, process.argv.slice(2), {
                                stdio: [
                                    process.stdin,
                                    'pipe',
                                    'pipe'
                                ],
                                cwd: PATH.join(cwd, "..", origin),
                                env: LODASH.merge({}, originalEnv, {
                                    "SOURCELOGIC_CONFIG_OVERLAY": JSON.stringify(config[origin] || {}, null, 4)
                                })
                            }).then(function (proc) {

                                originMeta[origin] = {
                                    O_CID: proc.O_CID,
                                    pid: proc.pid
                                };

                                if (!argv.config) {
                                    resolve(null);
                                }

                                return new Promise(function (resolve, reject) {
                                    var configBuffer = null;
                                    if (argv.config) {
                                        configBuffer = [];
                                    }
                                    proc.stderr.on("data", function (chunk) {
                                        process.stderr.write(chunk);
                                    });
                                    proc.stdout.on("data", function (chunk) {
                                        if (configBuffer) {
                                            configBuffer.push(chunk);
                                        } else {
                                            process.stdout.write(chunk);
                                            chunk = chunk.toString();
                                            var re = /\[org.sourcelogic\]\[([^\]]+)\]\[merge\]\s([^=]+)\s=\s(.+)\n/g;
                                            var m;
                                            while (m = re.exec(chunk)) {

                                                if (m[1] !== proc.O_CID) continue;

                                                //LODASH.set(config, m[2], LODASH.merge(LODASH.get(config, m[2], null), m[3]));
                                                //o.reExportConfig(config);

                                                var propertyPath = LODASH.toPath(m[2]);
                                                var message = {};
                                                if (propertyPath.length > 1) {
                                                    message["@" + propertyPath.shift()] = LODASH.set({}, propertyPath, JSON.parse(m[3]));
                                                } else {
                                                    message["@" + propertyPath.shift()] = JSON.parse(m[3]);
                                                }

                                                if (argv.verbose) console.error("[sourcelogic] Stdout var message from origin:", origin, message);
                                                
                                                o.broadcastMessage(message);
                                            }
                                        }
                                    });
                                    proc.on("error", reject);
                                    proc.on("close", function (code) {

                                        if (argv.verbose) console.error("[sourcelogic] Finished running origin:", PATH.join(cwd, "..", origin), "got code", code);

                                        if (configBuffer) {
                                            originMeta[origin].config = JSON.parse(Buffer.concat(configBuffer).toString());
                                        }
                                        resolve(code);
                                    });
                                });
                            }).then(function () {
                                resolve(null);
                                return null;
                            }).catch(function (err) {
                                console.error(err);
                                process.exit(1);
                            });

                        });                            
                    }).then(function () {
                    
                        return originMeta;
                    });
                }

                return runOrigins().then(function (originMeta) {

                    if (originMeta) {
                        config["org.sourcelogic"].origins$ = originMeta;
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
                        if (!argv.silent) console.error("[sourcelogic] Run command:", path, args, cwd);

                        return o.spawn(path, args, {
                            stdio: [
                                process.stdin,
                                'pipe',
                                'pipe'
                            ],
                            cwd: cwd
                        }).then(function (proc) {
                            return new Promise(function (resolve, reject) {
                                proc.stderr.on("data", function (chunk) {
                                    process.stderr.write(chunk);
                                });
                                proc.stdout.on("data", function (chunk) {
                                    process.stdout.write(chunk);
                                    chunk = chunk.toString();
                                    var re = /\[org.sourcelogic\]\[([^\]]+)\]\[merge\]\s([^=]+)\s=\s(.+)\n/g;
                                    var m;
                                    while (m = re.exec(chunk)) {
                                        
                                        if (m[1] !== proc.O_CID) continue;

                                        //LODASH.set(config, m[2], LODASH.merge(LODASH.get(config, m[2], null), m[3]));
                                        //o.reExportConfig(config);

                                        var propertyPath = LODASH.toPath(m[2]);
                                        var message = {};
                                        if (propertyPath.length > 1) {
                                            message["@" + propertyPath.shift()] = LODASH.set({}, propertyPath, JSON.parse(m[3]));
                                        } else {
                                            message["@" + propertyPath.shift()] = JSON.parse(m[3]);
                                        }

                                        if (argv.verbose) console.error("[sourcelogic] Stdout var message from script:", path, message);

                                        o.broadcastMessage(message);
                                    }
                                });
                                proc.on("error", reject);
                                proc.on("close", function (code) {
                                    if (argv.verbose) console.error("[sourcelogic] Finished running", path, "got code", code);
                                    resolve(code);
                                });
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

                            // NOTE: We offset starting the processes slightly so we can try and maintain the same order for output most of the time.
                            commands = commands.map(function (command, i) {
                                return Promise.delay(i * 50).then(function () {
                                    return command;
                                });
                            });

                            return Promise.map(commands, function (command) {

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
            });
    
        }).catch(function (err) {
            console.error(err.stack);
            process.exit(1);
        });        

    }

    forOriginDir(cwd, rOrigin);
}
