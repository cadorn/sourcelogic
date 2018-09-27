#!/usr/bin/env node

const O = require("../../../../sourcelogic").init("parentProject");
const ASSERT = O.require("assert");



// Keep script from exiting until we receive a message.
var interval1 = setInterval(function () {

    // Broadcast until we get a response below
    O.broadcastMessage({
        "@parentProject/ready": {
            "event": "from project"
        }
    });

}, 250);

O.on('@parentProject/start', function (message) {
    
    ASSERT.deepEqual(message, {
        event: 'from parentProject',
        message: {
            event: 'from project'
        }
    });

    console.log("project local-origin messaging worked!");

    setTimeout(function () {
        clearInterval(interval1);
    }, 100);


    
    // Keep script from exiting until we receive a message.
    var interval2 = setInterval(function () {

        // Broadcast until we get a response below
        O.broadcastMessage({
            "subProject@parentProject/ping": {
                "event": "from project"
            }
        });

    }, 250);

    O.on('subProject@parentProject/pong', function (message) {

        ASSERT.deepEqual(message, {
            event: 'from parentProject',
            message: {
                event: 'from project'
            }
        });

        console.log("project to subProject cross-origin messaging worked!");

        setTimeout(function () {
            clearInterval(interval2);
        }, 100);
    });

});
