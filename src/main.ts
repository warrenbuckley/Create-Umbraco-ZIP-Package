// Github Actions helper modules from NPM
import * as core from '@actions/core';
import * as io from '@actions/io';
import * as exec from '@actions/exec';

// NPM Community modules
import * as convert from 'xml-js';
import uuidv4 from 'uuid/v4';

// Native nodejs modules
import * as fs from 'fs';
import * as path from 'path';

async function run() {
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
    if(!packageXmlContents){
      core.setFailed("Was unable to open file or convert from XML to JS");
      return;
    }

    // Update Package XML/JSON version property from 'packageVersion' PARAM
    packageXmlContents = updatePackageVersion(packageVersion, packageXmlContents);

    // Verify folder exists for packageFilesPath
    if(fs.existsSync(packageFilesPath) === false){
      core.setFailed(`Can not find directory for package files at ${packageFilesPath}`);
    }

    // Get a recursive list of all file name/paths in a folder
    var packageFiles = getFilesFromDir(packageFilesPath);

    // Create folder 'build.umb.tmp' needed to copy/move files
    // into here as the folder we ZIP up
    await createBuildUmbTmp();

    var filesArray = new Array<object>();

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
      var guid = uuidv4();

      // rename file to GUID.txt
      var newFileName = guid + fileExt;
      var newFileLocation = path.join('./build.tmp.umb', fileDirName, newFileName);

      // Ensure directory is created/exists in build.tmp.umb (as copy will fail)
      if(fs.existsSync(path.dirname(newFileLocation)) === false){
        fs.mkdirSync(path.dirname(newFileLocation), {recursive: true});
      }

      // save/copy file to 'build.tmp.umb' folder as newFileName
      fs.copyFileSync(path.join(packageFilesPath, filepath), newFileLocation);

      core.debug(`Copying ${path.join(packageFilesPath, filepath)} to ${newFileLocation}`);

      // update JSON push new item into files array/xml
      if(packageXmlContents != null){

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
    await savePackageXmlFile(packageXmlContents);

    // Grab package name & convert to safe file name
    var packageNameFromXml = packageXmlContents.umbPackage.info.package.name._text;
    packageNameFromXml = packageNameFromXml.replace(' ', '_');

    // Create a ZIP package of the folder 'build.tmp.umb'
    await createPackageZip(packageNameFromXml, packageVersion);

    // YAY all done :)

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();


function openPackageXML(pathToXml:string):convert.ElementCompact | null {

  core.debug(`Checking if file ${pathToXml} exists`);

  // Check file exists first
  if(fs.existsSync(pathToXml) === false){
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
  var options:convert.Options.XML2JS = {
    compact: true,
    ignoreComment: true,
    alwaysChildren: true
  };
  var result = convert.xml2js(xmlContents, options);
  core.debug(`XML converted to JS: ${result}`);

  return result as convert.ElementCompact;
}


function updatePackageVersion(version:string, packageXmlContents:convert.ElementCompact):convert.ElementCompact{

  core.debug(`Updating the package version to ${version}`);

  // Update the package version in the JSON for the XML file
  packageXmlContents.umbPackage.info.package.version = version;
  return packageXmlContents;
}

async function createBuildUmbTmp():Promise<void> {
  // Check if we already have a folder called build.tmp.umb
  if(fs.existsSync('./build.tmp.umb')){
    // Delete the folder - so we know it's CLEAN
    await io.rmRF('./build.tmp.umb');
  }

  // Create the folder so it's empty & squeeky clean
  await io.mkdirP('./build.tmp.umb');
}

function getFilesFromDir(dir) {
  var filesToReturn = Array<string>();

  function walkDir(currentPath) {
    var files = fs.readdirSync(currentPath);
    for (var i in files) {
      var curFile = path.join(currentPath, files[i]);
      if (fs.statSync(curFile).isFile()) {
        filesToReturn.push(curFile.replace(dir, ''));
      } else if (fs.statSync(curFile).isDirectory()) {
       walkDir(curFile);
      }
    }
  };

  walkDir(dir);
  return filesToReturn;
}

async function savePackageXmlFile(packageXmlContents:convert.ElementCompact) : Promise<void> {
  // Convert the JS object back to XML string with tab indentation
  var xmlString = convert.js2xml(packageXmlContents, { compact: true, spaces: '\t' });

  core.debug(`Saving XML to './build.tmp.umb/package.xml'`);

  // Save the NEW package.xml as './build.tmp.umb/package.xml'
  return fs.writeFileSync('./build.tmp.umb/package.xml', xmlString);
}

async function createPackageZip(packageName:string, packageVersion:string): Promise<number>{

  // Verify 7Zip is available
  // 7Zip is on Windows VM on GH Actions
  // https://help.github.com/en/articles/software-in-virtual-environments-for-github-actions#windows-server-2019

  var zipFileName = `${packageName}${packageVersion}.zip`;
  var zipFileOutPath = path.join('./output', zipFileName);
  var folderToZipUp = path.resolve('./build.tmp.umb');

  // Run CMD line 7Zip
  // The .\ tells 7Zip to not include the root folder inside the archive
  // Path.
  return exec.exec('7z', ['a', '-r', zipFileOutPath, '.\\build.tmp.package\\*');

}