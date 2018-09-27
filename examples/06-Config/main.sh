#!/usr/bin/env bash.origin.script

pushd "projects/project" > /dev/null

    node ../../../../sourcelogic [parentProject].scripts.start --silent 1 --config | node --eval '
        var output = require("fs").readFileSync(0).toString();
        var result = JSON.parse(output);
        delete result["org.sourcelogic"]["origins$"].subProject.O_CID;
        delete result["org.sourcelogic"]["origins$"].subProject.pid;
        process.stdout.write(JSON.stringify(result, null, 4) + "\n");
    '

popd > /dev/null
