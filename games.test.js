const g=require("./games.js");
g.setDb([{name:"VALORANT",executables:[{os:"win32",name:"valorant-win64-shipping.exe",is_launcher:false},{os:"win32",name:"riotclientservices.exe",is_launcher:true}]},
{name:"Fortnite",executables:[{os:"win32",name:"fortniteclient-win64-shipping.exe"}]},
{name:"WoW",executables:[{os:"win32",name:"_retail_/wow.exe"},{os:"darwin",name:"world of warcraft.app"}]}]);
const a=(x,y)=>{if(x!==y){console.log("FAIL",x,y);process.exit(1)}};
a(g.matchGame([{name:"VALORANT-Win64-Shipping",path:""}]),"VALORANT");
a(g.matchGame([{name:"FortniteClient-Win64-Shipping",path:"C:\\x\\a.exe"}]),"Fortnite");
a(g.matchGame([{name:"wow",path:"C:\\Games\\World of Warcraft\\_retail_\\Wow.exe"}]),"WoW");
a(g.matchGame([{name:"riotclientservices",path:""}]),null);
a(g.matchGame([{name:"notepad",path:""}]),null);
console.log("games ok");
