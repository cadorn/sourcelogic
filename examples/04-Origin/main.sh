#!/usr/bin/env bash.origin.script

pushd "projects/project" > /dev/null

    node ../../../../sourcelogic [parentProject].scripts.start --silent 1

popd > /dev/null
