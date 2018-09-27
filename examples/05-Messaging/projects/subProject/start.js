#!/usr/bin/env node

const O = require("../../../../sourcelogic").init("parentProject");
const ASSERT = O.require("assert");

// Keep script from exiting until we receive a message.
var interval1 = setInterval(function () {

    // Broadcast until we get a response below
    O.broadcastMessage({
        "@parentProject/ready": {
            "event": "from subProject"
        }
    });

}, 250);

O.on('@parentProject/start', function (message) {

    ASSERT.deepEqual(message, {
        event: 'from parentProject',
        message: {
            event: 'from subProject'
        }
    });

    console.log("Messaging worked in subProject!");

    setTimeout(function () {
        clearInterval(interval1);
    }, 100);
});



// Keep script from exiting until we receive a message.
var interval2 = setInterval(function () {}, 1000);

O.on('@parentProject/ping', function (message) {

    O.broadcastMessage({
        "@parentProject/pong": {
            "event": "from parentProject",
            message: message
        }
    });

    setTimeout(function () {
        clearInterval(interval2);
    }, 100);
});
