#!/usr/bin/env node

const O = require("../../../../sourcelogic").init("parentProject");
const ASSERT = O.require("assert");



// Keep script from exiting until we receive a message.
var interval = setInterval(function () {}, 1000);

O.on('@parentProject/ready', function (message) {

    O.broadcastMessage({
        "@parentProject/start": {
            "event": "from parentProject",
            message: message
        }
    });

    setTimeout(function () {
        clearInterval(interval);
    }, 100);
});
