#!/usr/bin/env node

const O = require("../../../../sourcelogic").init("project");

var str = JSON.stringify(O.LAYERS, null, 4);
str = str.replace(new RegExp(O.require("path").join(__dirname, "../..").replace(/\//g, "\\/"), "g"), "../..");
console.log("O.LAYERS", str);

str = JSON.stringify(O.CONFIG, null, 4);
str = str.replace(new RegExp(O.require("path").join(__dirname, "../..").replace(/\//g, "\\/"), "g"), "../..");
console.log("O.CONFIG", str);
