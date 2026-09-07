# Real-data upgrade path

- **USGS Earthquake Catalog / FDSN Web Service:** supports CSV and GeoJSON queries and is appropriate for observed earthquake-event inputs. It should not be presented as an earthquake-occurrence predictor. See the official documentation at https://earthquake.usgs.gov/fdsnws/event/1/ .
- **NOAA/NCEI IBTrACS v04r01:** global historical tropical-cyclone best-track archive available in CSV, NetCDF, and shapefile formats. See https://www.ncei.noaa.gov/products/international-best-track-archive .
- **Google Earth Engine flood dataset catalog:** includes the Global Flood Database and other flood-hazard collections. Verify the exact dataset access and licensing before using it in a submission. See https://developers.google.com/earth-engine/datasets/tags/flood .

For flood occurrence, replace the demo fixture with a dataset whose labels and provenance are documented. Do not infer a real-world target from a deterministic threshold and then present it as measured ground truth.
