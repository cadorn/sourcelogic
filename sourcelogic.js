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


function SourceLogic (cwd, rOrigin) {

    var self = this;

    self.layers = function () {
        var layers = [];
        var path = null;
        var newDir = null;
        function nextFS (dir) {
            newDir = PATH.dirname(dir);
            if (newDir === dir) {
                return null;
            }
            return walkFS(newDir);
        }
        function walkExtends (parentConfigPath, config) {
            if (config["@extends"]) {
                var uid = config["@extends"];
                delete config["@extends"];

                function load (cwd, uid, prepend) {
                    return exports.for(cwd, uid).layers().then(function (_layers) {                        
                        if (_layers[0].context !== uid) {
                            throw new Error("Cannot @extend config '" + parentConfigPath + "' with origin '" + uid + "' because origin does not have @context '" + uid + "' and has instead '" + _layers[0].context + "'.");
                        }
                        if (prepend) {
                            layers = Array.prototype.concat.apply(_layers, layers);                            
                        } else {
                            layers = Array.prototype.concat.apply(layers, _layers);
                        }
                        return null;
                    });
                }
                return load(cwd, uid).then(function () {
                    return load(PATH.join(parentConfigPath, "../../..", uid), uid, true);
                });
            }
            return Promise.resolve(null);
        }
        function walkFS (dir) {
            path = PATH.join(dir, "o", rOrigin + ".json");
            return FS.existsAsync(path).then(function (exists) {
                if (!exists) return nextFS(dir);
                return FS.readFile(path, "utf8").then(function (config) {

                    config = config.replace(/\$\{__DIRNAME__\}/g, PATH.dirname(path));

                    config = JSON.parse(config);

                    if (!config["@context"]) {
                        throw new Error("No @context specified in config '" + path + "' where '" + rOrigin + "' is expected!");
                    } else
                    if (config["@context"] !== rOrigin) {
                        throw new Error("Found wrong @context of '" + config["@context"] + "' in config '" + path + "' where '" + rOrigin + "' is expected!");
                    }

                    var context = config["@context"];
                    delete config["@context"];

                    layers.push({
                        path: path,
                        context: context,
                        config: config
                    });
                    return walkExtends(path, config).then(function () {
                        return nextFS(dir)
                    });
                });
            });
        }
        return walkFS(cwd).then(function () {
            return layers;
        });
    }
    
    self.config = function () {
        function mergeCustomizer (objValue, srcValue) {
            if (Array.isArray(objValue)) {
                return objValue.concat(srcValue);
            }
        }
        return self.layers().then(function (layers) {

//            console.log("Layers:", JSON.stringify(layers, null, 4));

            var config = {};
            layers.forEach(function (layer) {

//                console.log("Merge:", layer.path);

                LODASH.mergeWith(config, layer.config, mergeCustomizer);
            });
            return config;
        });    
    }
}


exports.for = function (cwd, rOrigin) {

    var key = cwd + ":" + rOrigin;

    if (!exports.for._cache[key]) {
        exports.for._cache[key] = new SourceLogic(cwd, rOrigin);
    }

    return exports.for._cache[key];
}
exports.for._cache = {};




if (require.main === module) {

    var cwd = process.cwd();
    var rOrigin = PATH.basename(cwd);
    var o = exports.for(cwd, rOrigin);
    o.config().then(function (config) {

        process.env.SOURCELOGIC_CONFIG = JSON.stringify(config, null, 4);

// TODO: Do not display 'AWS_SECRET_ACCESS_KEY' and other sensitive variables
        console.error("Config:", process.env.SOURCELOGIC_CONFIG);

        // Put some utility commands on the path
        process.env.PATH = (PATH.join(__dirname, "node_modules/.bin") + ":" + process.env.PATH);

        if (!process.argv[2]) {
            throw new Error("No command to run specified!");
        }

        function run (path) {
            return new Promise(function (resolve, reject) {

                console.error("Run command:", path);

                var proc = SPAWN(path, process.argv.slice(3), {
                    stdio: "inherit"
                });
                proc.on("error", reject);
                proc.on("close", resolve);
            });
        }
        
        var path = process.argv[2];
        if (/^\./.test(path)) {
            path = PATH.join(cwd, path);
        } else {
            if (!LODASH.has(config, path.split("."))) {
                throw new Error("Cannot run command at property path '" + path + "' for cwd '" + cwd + "' and rOrigin '" + rOrigin + "' because property does not exist in referenced 'o/' config files.");
            }
            path = LODASH.get(config, path.split("."));
        }

        if (!Array.isArray(path)) {
            path = [ path ];
        }

        return Promise.mapSeries(path, run);

    }).catch(function (err) {
        console.error(err.stack);
        process.exit(1);
    });
}
