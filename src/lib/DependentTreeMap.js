"use strict";


const path = require('path');
const fs = require('fs');
const log = require('./logger');
const assert = require('assert');


class DependentLinkNode {
    constructor({type, version, packageNode}) {
        assert(packageNode instanceof PackageNode, 'packageNode must be an instance of PackageNode class.');
        assert(type && version);
        this.type = type;
        this.version = version;
        this.packageNode = packageNode;
    }
}

class PackageNode {
    constructor({name, version, packageJson}) {
        assert(name && version && packageJson, `One of {name, version, packageJson} was not included in PackageNode : ${name} ${version} ${packageJson}`);
        this.name = name;
        this.version = version;
        this.packageJson = packageJson;
        this._dependents = {};
    }

    addDependent(packageName, linkNode) {
        assert(linkNode instanceof DependentLinkNode);
        this._dependents[packageName] = linkNode;
    }

    iterateDependents(callback) {
        Object.keys(this._dependents).forEach(key => {
            callback(this._dependents[key], key);
        });
    }
}


class DependentTreeMap {

    constructor() {
        this.packageStore = {};
        /**
         * Example structure :
         *      {
         *          "package-name-1": PackageNode({
         *              name,
         *              version,
         *              packageJson
         *              dependents: {
         *                  "package-name-2": PackageNode({ ... }),
         *                  "package-name-3": PackageNode({ ... }),
         *              },
         *          })
         *      }
         */
        this._buildPackageStore();
    }

    getDependentTree(packageName) {
        const packageNode = this.packageStore[packageName];
        if (!packageNode) {
            const msg = `Invalid package name, ${packageName} not found in dependent map`;
            log.error(msg);
            throw new Error(msg);
        }
        log.trace(packageNode);
        return this._buildTreeRecur(packageNode, {}, [packageName])
    }


    _buildTreeRecur(currNode, obj, pathToNode) {
        const occurrences = pathToNode.filter(n => n === currNode.name).length;
        if (occurrences > 1) {
            log.warn(`found circular dependency for ${currNode.name}, path : ${JSON.stringify(pathToNode)}`);
            return;
        } else {
            log.trace(`building dependent tree, path to ${currNode.name} = ${JSON.stringify(pathToNode)}`)
        }

        currNode.iterateDependents((linkNode, packageName) => {
            const {packageNode, type, version} = linkNode;
            obj[packageName] = {type, version, dependents: {}};
            return this._buildTreeRecur(packageNode, obj[packageName].dependents, [...pathToNode, packageName]);
        });

        return obj;
    }


    iteratePackageStore(callback) {
        Object.keys(this.packageStore).forEach(packageName => {
            callback(this.packageStore[packageName], packageName);
        });
    }

    _buildPackageStore() {
        const packagesPath = path.resolve(`${__dirname}/../../packageJsons`);

        fs.readdirSync(packagesPath)
            .forEach(file => {
                const jsonPath = path.resolve(`${packagesPath}/${file}`);
                let packageJson;

                try {
                    packageJson = require(jsonPath);
                    const {name, version} = packageJson;
                    this.packageStore[name] = new PackageNode({
                        name, version, packageJson
                    });
                    log.trace(`Successfully required package.json from ${jsonPath}`);

                } catch (e) {
                    log.trace(`package.json exists for ${jsonPath} but could not be required`);
                }
            });


        this.iteratePackageStore((packageNode) => {
            const {dependencies = {}, devDependencies = {}, peerDependencies = {}} = packageNode.packageJson;
            this._addDependentsToPackage(packageNode, dependencies, 'dependencies');
            this._addDependentsToPackage(packageNode, devDependencies, 'devDependencies');
            this._addDependentsToPackage(packageNode, peerDependencies, 'peerDependencies');
        });

    }

    // packageName becomes a dependency of every entry in depObj - if it exists in the store.
    _addDependentsToPackage (packageNode, depObj, type) {
        Object.keys(depObj).forEach(dependencyName => {
            if (this.packageStore.hasOwnProperty(dependencyName)) {
                // packageNode has a dependency of dependencyName - therefore dependencyName is dependent on packageNode
                const dependentPackageNode = this.packageStore[dependencyName];
                const version = depObj[dependencyName];
                dependentPackageNode.addDependent(packageNode.name, new DependentLinkNode({
                    type, version, packageNode
                }));
            }
        });
    }
}

module.exports = DependentTreeMap;
