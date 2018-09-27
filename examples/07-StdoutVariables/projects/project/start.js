#!/usr/bin/env node

const O = require("../../../../sourcelogic").init("parentProject");
const ASSERT = O.require("assert");

    
// Keep script from exiting until we receive a message.
var interval = setInterval(function () {

    // Broadcast until we get a response below
    O.broadcastMessage({
        "subProject@parentProject/ping": {
            "event": "from project"
        }
    });

}, 250);

O.on('subProject@parentProject/pong', function (message) {

    var config = O.CONFIG;

    delete config["org.sourcelogic"].origins$.subProject.O_CID;
    delete config["org.sourcelogic"].origins$.subProject.pid;

    console.log(JSON.stringify(config, null, 4));

    setTimeout(function () {
        clearInterval(interval);
    }, 100);
});
