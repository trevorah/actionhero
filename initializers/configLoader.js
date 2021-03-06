var fs = require('fs');
var path = require('path');
var argv = require('optimist').argv;

var configLoader = function(api, next){

  api.configLoader = {
    _start: function(api, callback){
      api.log('environment: ' + api.env);
      callback();
    }
  }

  api.watchedFiles = [];

  api.watchFileAndAct = function(file, callback){
    if(api.config.general.developmentMode == true && api.watchedFiles.indexOf(file) < 0){
      api.watchedFiles.push(file);
      fs.watchFile(file, {interval: 1000}, function(curr, prev){
        if(curr.mtime > prev.mtime){
          process.nextTick(function(){
            var cleanPath = file;
            if(process.platform === 'win32'){
              cleanPath = file.replace(/\//g, '\\');
            }
            delete require.cache[require.resolve(cleanPath)];
            callback();
          });
        }
      });
    }
  };

  api.unWatchAllFiles = function(){
    for(var i in api.watchedFiles){
      fs.unwatchFile(api.watchedFiles[i]);
    }
    api.watchedFiles = [];
  };

  if(api._startingParams.api != null){
    api.utils.hashMerge(api, api._startingParams.api);
  }

  api.env = 'development'

  if(argv['NODE_ENV'] != null){
    api.env = argv['NODE_ENV'];
  } else if(process.env.NODE_ENV != null){
    api.env = process.env.NODE_ENV;
  }

  var configPath = path.resolve(api.project_root, 'config');

  if(argv['config'] != null){
    if(argv['config'].charAt(0) == '/'){ configPath = argv['config'] }
    else { configPath = path.resolve(api.project_root, argv['config']) }
  } else if(process.env.ACTIONHERO_CONFIG != null) {
    if(process.env.ACTIONHERO_CONFIG.charAt(0) == '/'){ configPath = process.env.ACTIONHERO_CONFIG }
    else { configPath = path.resolve(api.project_root, process.env.ACTIONHERO_CONFIG) }
  } else if(!fs.existsSync(configPath)){
    throw new Error(configPath + 'No config directory found in this project, specified with --config, or found in process.env.ACTIONHERO_CONFIG');
  }

  api.loadConfigDirectory = function(configPath, watch){
    var configFiles = api.utils.recursiveDirectoryGlob(configPath);
    
    var loadRetries = 0;
    var loadErrors = {};
    for(var i = 0, limit = configFiles.length; (i < limit); i++){
      var f = configFiles[i];
      try{
        // attempt configuration file load
        var localConfig = require(f);
        if(localConfig.default != null){  api.config = api.utils.hashMerge(api.config, localConfig.default, api); }
        if(localConfig[api.env] != null){ api.config = api.utils.hashMerge(api.config, localConfig[api.env], api); }
        // configuration file load success: clear retries and
        // errors since progress has been made
        loadRetries = 0;
        loadErrors = {};
      } catch(error){
        // error loading configuration, abort if all remaining
        // configuration files have been tried and failed
        // indicating inability to progress 
        loadErrors[f] = error.toString();
        if(++loadRetries == limit-i){
            throw new Error('Unable to load configurations, errors: '+JSON.stringify(loadErrors));
        }
        // adjust configuration files list: remove and push
        // failed configuration to the end of the list and
        // continue with next file at same index
        configFiles.push(configFiles.splice(i--, 1)[0]);
        continue;
      }

      if(watch !== false){
        // configuration file loaded: set watch
        api.watchFileAndAct(f, function(){
          api.log('\r\n\r\n*** rebooting due to config change ***\r\n\r\n', 'info');
          delete require.cache[require.resolve(f)];
          api.commands.restart.call(api._self);
        });
      }      
    }

    // We load the config twice. Utilize configuration files load order that succeeded on the first pass.
    // This is to allow 'literal' values to be loaded whenever possible, and then for refrences to be resolved
    configFiles.forEach(function(f){
      var localConfig = require(f);
      if(localConfig.default != null){  api.config = api.utils.hashMerge(api.config, localConfig.default, api); }
      if(localConfig[api.env] != null){ api.config = api.utils.hashMerge(api.config, localConfig[api.env], api); }
    });
  
  }

  api.config = {};
  
  //load the default config of actionhero
  api.loadConfigDirectory(__dirname + '/../config', false);

  //load the project specific config
  api.loadConfigDirectory(configPath);
  
  var plugin_actions      = [];
  var plugin_tasks        = [];
  var plugin_servers      = [];
  var plugin_initializers = [];
  var plugin_publics      = [];
  
  //loop over it's plugins
  api.config.general.paths.plugin.forEach(function(p){
    api.config.general.plugins.forEach(function(plugin){
      var pluginPackageBase = path.normalize(p + '/' + plugin);
      if(api.project_root != pluginPackageBase){
        if(fs.existsSync(pluginPackageBase + "/config")){
          //and merge the plugin config 
          api.loadConfigDirectory( pluginPackageBase + '/config', false);
          //collect all paths that could have multiple target folders
          plugin_actions      = plugin_actions.concat(api.config.general.paths.action);
          plugin_tasks        = plugin_tasks.concat(api.config.general.paths.task);
          plugin_servers      = plugin_servers.concat(api.config.general.paths.server);
          plugin_initializers = plugin_initializers.concat(api.config.general.paths.initializer);
          plugin_publics      = plugin_publics.concat(api.config.general.paths.public);
        }
        //additionally add the following paths if they exists
        if(fs.existsSync(pluginPackageBase + "/actions")){      plugin_actions.unshift(      pluginPackageBase + '/actions'      );}
        if(fs.existsSync(pluginPackageBase + "/tasks")){        plugin_tasks.unshift(        pluginPackageBase + '/tasks'        );}
        if(fs.existsSync(pluginPackageBase + "/servers")){      plugin_servers.unshift(      pluginPackageBase + '/servers'      );}
        if(fs.existsSync(pluginPackageBase + "/initializers")){ plugin_initializers.unshift( pluginPackageBase + '/initializers' );}
        if(fs.existsSync(pluginPackageBase + "/public")){       plugin_publics.unshift(      pluginPackageBase + '/public'       );}
      }
    });    
  });
  
  //now load the project config again to overrule plugin configs
  api.loadConfigDirectory(configPath);
  
  //apply plugin paths for actions, tasks, servers and initializers
  api.config.general.paths.action      = plugin_actions.concat(api.config.general.paths.action);
  api.config.general.paths.task        = plugin_tasks.concat(api.config.general.paths.task);
  api.config.general.paths.server      = plugin_servers.concat(api.config.general.paths.server);
  api.config.general.paths.initializer = plugin_initializers.concat(api.config.general.paths.initializer);
  api.config.general.paths.public      = plugin_publics.concat(api.config.general.paths.public);
        
  // the first plugin path shoud alawys be the local project
  api.config.general.paths.public.reverse();

  //finally merge starting params into the config
  if(api._startingParams.configChanges != null){
    api.config = api.utils.hashMerge(api.config, api._startingParams.configChanges);
  }

  // cleanup
  api.config.general.paths.action      = api.utils.arrayUniqueify( api.config.general.paths.action.map(path.normalize) );
  api.config.general.paths.task        = api.utils.arrayUniqueify( api.config.general.paths.task.map(path.normalize) );
  api.config.general.paths.server      = api.utils.arrayUniqueify( api.config.general.paths.server.map(path.normalize) );
  api.config.general.paths.initializer = api.utils.arrayUniqueify( api.config.general.paths.initializer.map(path.normalize) );
  api.config.general.paths.public      = api.utils.arrayUniqueify( api.config.general.paths.public.map(path.normalize) );
  api.config.general.paths.pid         = api.utils.arrayUniqueify( api.config.general.paths.pid.map(path.normalize) );
  api.config.general.paths.log         = api.utils.arrayUniqueify( api.config.general.paths.log.map(path.normalize) );
  api.config.general.paths.plugin      = api.utils.arrayUniqueify( api.config.general.paths.plugin.map(path.normalize) );

  next();
}


/////////////////////////////////////////////////////////////////////
// exports
exports.configLoader = configLoader;