#!/usr/bin/env node

const O = require("../../../../sourcelogic").init("parentProject");

O.broadcastMessage({
    "@parentProject/hello": {
        "event": "from parentProject"
    }
});
