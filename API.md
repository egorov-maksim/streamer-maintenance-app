See [README.md](README.md) for overview and its [Running the Tests](README.md#running-the-tests) section for test setup.

Project and config JSON include the boolean `ebFront` (default `false`, stored as `eb_front`): when `true` the streamer has an extra eBird in front of the first section and all eBirds are numbered one higher. It is set with the other project fields (`moduleFrequency`, `useRopeForTail`) on `POST /api/projects`, `PUT /api/projects/:id` and `PUT /api/config` (active project).
