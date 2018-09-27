#!/usr/bin/env node

const O = require("../../../../sourcelogic").init("parentProject");

delete O.CONFIG["org.sourcelogic"].origins$;

var str = JSON.stringify(O.CONFIG, null, 4);
str = str.replace(new RegExp(O.require("path").join(__dirname, "../..").replace(/\//g, "\\/"), "g"), "../..");
console.log("project O.CONFIG", str);
