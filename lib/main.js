"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Github Actions helper modules from NPM
const core = __importStar(require("@actions/core"));
const io = __importStar(require("@actions/io"));
const exec = __importStar(require("@actions/exec"));
// NPM Community modules
const convert = __importStar(require("xml-js"));
const v4_1 = __importDefault(require("uuid/v4"));
// Native nodejs modules
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Our GitHub Actions Input Params
            const packageXmlPath = core.getInput('packageXmlPath', { required: true });
            const packageVersion = core.getInput('packageVersion', { required: true });
            const packageFilesPath = core.getInput('packageFilesPath', { required: true });
            // var packageXmlPath = "./package.xml";
            // var packageVersion = "1.4.1";
            // var packageFilesPath = "packagefiles";
            // Try & open package.xml file & convert to JSON obj
            var packageXmlContents = openPackageXML(packageXmlPath);
            if (!packageXmlContents) {
                core.setFailed("Was unable to open file or convert from XML to JS");
                return;
            }
            // Update Package XML/JSON version property from 'packageVersion' PARAM
            packageXmlContents = updatePackageVersion(packageVersion, packageXmlContents);
            // Verify folder exists for packageFilesPath
            if (fs.existsSync(packageFilesPath) === false) {
                core.setFailed(`Can not find directory for package files at ${packageFilesPath}`);
            }
            // Get a recursive list of all file name/paths in a folder
            var packageFiles = getFilesFromDir(packageFilesPath);
            // Create folder 'build.umb.tmp' needed to copy/move files
            // into here as the folder we ZIP up
            yield createBuildUmbTmp();
            var filesArray = new Array();
            // Loop over all the files found
            packageFiles.forEach(filepath => {
                core.debug(`Processing file ${filepath} to be added to package`);
                // 'package.manifest'
                var filename = path.basename(filepath);
                // '.manifest'
                var fileExt = path.extname(filepath);
                // 'packagefiles\App_plugins\MyPackage'
                var fileDirName = path.dirname(filepath);
                // create GUID
                var guid = v4_1.default();
                // rename file to GUID.txt
                var newFileName = guid + fileExt;
                var newFileLocation = path.join('./build.tmp.umb', fileDirName, newFileName);
                // Ensure directory is created/exists in build.tmp.umb (as copy will fail)
                if (fs.existsSync(path.dirname(newFileLocation)) === false) {
                    fs.mkdirSync(path.dirname(newFileLocation), { recursive: true });
                }
                // save/copy file to 'build.tmp.umb' folder as newFileName
                // TODO: Y U NO COPY?!
                fs.copyFileSync(path.join(packageFilesPath, filepath), newFileLocation);
                // update JSON push new item into files array/xml
                if (packageXmlContents != null) {
                    // guid == guid.txt
                    // orgPath == bin or App_Plugins/MyPackage
                    // orgName == original-file-name.dll
                    var fileObj = {
                        guid: guid,
                        orgPath: fileDirName,
                        orgName: filename
                    };
                    filesArray.push(fileObj);
                }
            });
            // Assign the array of files onto the JS obj reperesntation of the XML
            packageXmlContents.umbPackage.files = { file: filesArray };
            // Convert JSON back to XML
            // Save the NEW XML to 'build.tmp.umb'
            yield savePackageXmlFile(packageXmlContents);
            // Grab package name & convert to safe file name
            var packageNameFromXml = packageXmlContents.umbPackage.info.package.name._text;
            packageNameFromXml = packageNameFromXml.replace(' ', '_');
            // Create a ZIP package of the folder 'build.tmp.umb'
            yield createPackageZip(packageNameFromXml, packageVersion);
            // YAY all done :)
        }
        catch (error) {
            core.setFailed(error.message);
        }
    });
}
run();
function openPackageXML(pathToXml) {
    core.debug(`Checking if file ${pathToXml} exists`);
    // Check file exists first
    if (fs.existsSync(pathToXml) === false) {
        // Does this stop all excution immediately?
        core.setFailed(`Unable to find package.xml at '${pathToXml}'`);
        return null;
    }
    core.debug(`File found, now reading its contents`);
    // Read the file contents
    // TODO: May need to wrap in try/catch as permissions or locking perhaps?
    var xmlContents = fs.readFileSync(pathToXml).toString();
    core.debug(`File opened, now attempting to convert XML to JS object`);
    // Convert XML to JSON object
    // Throw error if invalid XML or not XML etc...
    var options = {
        compact: true,
        ignoreComment: true,
        alwaysChildren: true
    };
    var result = convert.xml2js(xmlContents, options);
    core.debug(`XML converted to JS: ${result}`);
    return result;
}
function updatePackageVersion(version, packageXmlContents) {
    core.debug(`Updating the package version to ${version}`);
    // Update the package version in the JSON for the XML file
    packageXmlContents.umbPackage.info.package.version = version;
    return packageXmlContents;
}
function createBuildUmbTmp() {
    return __awaiter(this, void 0, void 0, function* () {
        // Check if we already have a folder called build.tmp.umb
        if (fs.existsSync('./build.tmp.umb')) {
            // Delete the folder - so we know it's CLEAN
            yield io.rmRF('./build.tmp.umb');
        }
        // Create the folder so it's empty & squeeky clean
        yield io.mkdirP('./build.tmp.umb');
    });
}
function getFilesFromDir(dir) {
    var filesToReturn = Array();
    function walkDir(currentPath) {
        var files = fs.readdirSync(currentPath);
        for (var i in files) {
            var curFile = path.join(currentPath, files[i]);
            if (fs.statSync(curFile).isFile()) {
                filesToReturn.push(curFile.replace(dir, ''));
            }
            else if (fs.statSync(curFile).isDirectory()) {
                walkDir(curFile);
            }
        }
    }
    ;
    walkDir(dir);
    return filesToReturn;
}
function savePackageXmlFile(packageXmlContents) {
    return __awaiter(this, void 0, void 0, function* () {
        // Convert the JS object back to XML string with tab indentation
        var xmlString = convert.js2xml(packageXmlContents, { compact: true, spaces: '\t' });
        core.debug(`Saving XML to './build.tmp.umb/package.xml'`);
        // Save the NEW package.xml as './build.tmp.umb/package.xml'
        return fs.writeFileSync('./build.tmp.umb/package.xml', xmlString);
    });
}
function createPackageZip(packageName, packageVersion) {
    return __awaiter(this, void 0, void 0, function* () {
        // Verify 7Zip is available
        // 7Zip is on Windows VM on GH Actions
        // https://help.github.com/en/articles/software-in-virtual-environments-for-github-actions#windows-server-2019
        var zipFileName = `${packageName}${packageVersion}.zip`;
        var zipFileOutPath = path.resolve(path.join('./out', zipFileName));
        var folderToZipUp = path.resolve('./build.tmp.umb');
        // Run CMD line 7Zip
        return exec.exec('7zip', ['a', '-r', zipFileOutPath, folderToZipUp]);
    });
}
//# sourceMappingURL=main.js.map