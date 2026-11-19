[out:xml][timeout:900][maxsize:2000000000][bbox:42.79,74.46,42.94,74.72];
(
  way["highway"];
  way["building"];
  relation["building"];
  node["natural"="tree"];
  way["natural"~"^(tree_row|wood|scrub)$"];
  way["landuse"="forest"];
  way["leisure"~"^(park|garden)$"];
  relation["leisure"~"^(park|garden)$"];
);
(._;>;);
out body;
