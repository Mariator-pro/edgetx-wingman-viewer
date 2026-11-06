# Satellite map

[Back to the README](../README.md)

The street map works without any setup. Satellite imagery comes from Esri (World Imagery) and needs your own ArcGIS key; the app has no key of its own. The free plan of ArcGIS Location Platform covers 2 million map tiles a month, far more than looking at your flights needs.

## 1. Create an account

Go to [location.arcgis.com](https://location.arcgis.com) and sign in, or sign up for a free account. It has to be an **ArcGIS Location Platform** account; the developer documentation on developers.arcgis.com is only for reading, keys are not created there.

## 2. Create the key

After signing in, the dashboard shows **My portal**. There:

1. Open **Content**, then **My content**, then **New item**.
2. Choose **Developer credentials**, then **API key credentials**, and click **Next**.
3. Answer the steps as follows:

| Step | Choose |
|---|---|
| Where will you use these credentials? | **Public application** |
| Item access | **No item access** |
| Privileges | Under **Location services**, turn on **Basemaps** only (both entries in it, "Basemap styles service" and "Static basemap tiles"). Leave everything else off (places, geocoding, routing and so on). |
| Expiration | As late as possible (at most one year) |
| Referrer URLs | Leave empty: the app runs on `localhost` with a port that changes with every start, so a fixed address would block it |
| Title | For example "EdgeTX Wingman Viewer" |

4. At the end, generate the key and **copy it right away**. Esri shows it only once; if it is lost, generate a new one on the page of the item.

The pages may be shown in your language: in German, for example, the steps are called "Entwickler-Anmeldeinformationen", "Anmeldeinformationen für API-Schlüssel", "Positionsservices" and "Grundkarten".

## 3. Add the key to the app

1. Open **Settings** in the app.
2. Paste the key into **ArcGIS key** on the map card and click **Save**.
3. Open a flight and choose **Satellite** with the map type button at the top right of the map.

## When the key runs out

Keys expire on the date chosen above, so create a new one in time: on the item's page in your portal (or a new item as above), then paste it into **Settings** again.

If Esri refuses the tiles, the legend on the map shows "Esri doesn't send the satellite imagery. Check your ArcGIS key in Settings."

## Your account and your data

Your ArcGIS account is your own agreement with Esri, and its terms apply to how you use the imagery.

The key is stored only in the app's [data folder](../README.md#your-data-on-the-computer) on your computer and is sent only to Esri, with each satellite tile. Those requests also tell Esri which areas you are looking at, so where you fly can be linked to your account.
