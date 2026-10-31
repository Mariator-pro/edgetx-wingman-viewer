-- Lipo-Nanny configuration (test data).
return {
  ["batteries"] = {
    {
      ["id"] = "bat_001",
      ["name"] = "Sample 6s 1300mAh",
      ["chemistry"] = "LiPo",
      ["cells"] = 6,
      ["instances"] = {
        { ["id"] = "pack_0001", ["label"] = 1 },
        { ["id"] = "pack_0002", ["label"] = 2 },
      },
    },
  },
  ["models"] = {
    ["model1.yml"] = { ["batteryIds"] = { "bat_001" }, ["cells"] = 6, ["parallel"] = false },
  },
}
