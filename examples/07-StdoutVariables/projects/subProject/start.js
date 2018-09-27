#!/usr/bin/env node

const O = require("../../../../sourcelogic").init("parentProject");

console.log('[org.sourcelogic][' + process.env.O_CID + '][merge] dynamicVarFromSubProject = ' + JSON.stringify({
    "key1": "val1",
    "key2": [
        "item1"
    ]
}));

// Keep script from exiting until we receive a message.
var interval = setInterval(function () {}, 1000);

O.on('@parentProject/ping', function (message) {

    console.log('[org.sourcelogic][' + process.env.O_CID + '][merge] dynamicVarFromSubProject.key2 = ' + JSON.stringify([
        "item2"
    ]));

    O.broadcastMessage({
        "@parentProject/pong": {
            "event": "from subProject",
            message: message
        }
    });

    setTimeout(function () {
        clearInterval(interval);
    }, 100);
});
