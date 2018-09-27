#!/usr/bin/env bash.origin.script

pushd "projects/project" > /dev/null

    echo ">>>TEST_IGNORE_LINE:\[org\.sourcelogic\]\[O_CID_<<<"

    node ../../../../sourcelogic [parentProject].scripts.start --silent 1

popd > /dev/null
