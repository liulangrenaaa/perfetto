// Copyright (C) 2024 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {Trace} from '../../public/trace';
import {PerfettoPlugin} from '../../public/plugin';
import {createQuerySliceTrack} from '../../components/tracks/query_slice_track';
import {TrackNode} from '../../public/workspace';

export default class implements PerfettoPlugin {
  static readonly id = 'dev.perfetto.AndroidStartuplucas';

  async onTraceLoad(ctx: Trace): Promise<void> {
    const e = ctx.engine;
    await e.query(`
          include perfetto module android.startup.startups;
          include perfetto module android.startup.startup_breakdowns;
         `);


    const trackSource = `
          SELECT l.ts AS ts, l.dur AS dur, l.package AS name
          FROM android_startups l
    `;


    const trackNode = await this.loadStartupTrack(
      ctx,
      trackSource,
      `/AndroidStartuplucas`,
      'Android App Startups',
    );

    ctx.workspace.addChildInOrder(trackNode);
  }

  private async loadStartupTrack(
    ctx: Trace,
    sqlSource: string,
    uri: string,
    title: string,
  ): Promise<TrackNode> {
    const track = await createQuerySliceTrack({
      trace: ctx,
      uri,
      data: {
        sqlSource,
        columns: ['ts', 'dur', 'name'],
      },
    });
    ctx.tracks.registerTrack({
      uri,
      title,
      track,
    });
    // Needs a sort order lower than 'Ftrace Events' so that it is prioritized in the UI.
    return new TrackNode({title, uri, sortOrder: -6});
  }
}
