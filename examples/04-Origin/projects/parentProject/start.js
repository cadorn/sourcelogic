#!/usr/bin/env node

const O = require("../../../../sourcelogic").init("parentProject");

if (O.CONFIG["org.sourcelogic"]) {
    delete O.CONFIG["org.sourcelogic"].origins$;
}

var str = JSON.stringify(O.CONFIG, null, 4);
str = str.replace(new RegExp(O.require("path").join(__dirname, "../..").replace(/\//g, "\\/"), "g"), "../..");
console.log("parentProject O.CONFIG", str);
