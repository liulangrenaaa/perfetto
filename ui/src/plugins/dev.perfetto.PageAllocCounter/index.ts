// Copyright (C) 2021 The Android Open Source Project
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

import {THREAD_STATE_TRACK_KIND} from '../../public/track_kinds';
import {Trace} from '../../public/trace';
import {PerfettoPlugin} from '../../public/plugin';
import {getThreadUriPrefix, getTrackName} from '../../public/utils';
import {NUM, NUM_NULL, STR_NULL} from '../../trace_processor/query_result';
import {createQueryCounterTrack} from '../../components/tracks/query_counter_track';
import {removeFalsyValues} from '../../base/array_utils';
import {TrackNode} from '../../public/workspace';
import ProcessThreadGroupsPlugin from '../dev.perfetto.ProcessThreadGroups';
import {createQuerySliceTrack} from '../../components/tracks/query_slice_track';

function uriForThreadStatePageAllocPages(upid: number | null, utid: number): string {
  return `${getThreadUriPrefix(upid, utid)}_state_pages`;
}

function uriForThreadStatePageAllocTimes(upid: number | null, utid: number): string {
  return `${getThreadUriPrefix(upid, utid)}_state_times`;
}

function uriForThreadStatePageAllocTimeout(upid: number | null, utid: number): string {
  return `${getThreadUriPrefix(upid, utid)}_state_timeout`;
}

function uriForThreadStatePageFault(upid: number | null, utid: number): string {
  return `${getThreadUriPrefix(upid, utid)}_pagefault`;
}

export default class implements PerfettoPlugin {
  static readonly id = 'dev.perfetto.PageAllocCounter';
  static readonly dependencies = [ProcessThreadGroupsPlugin];

  async onTraceLoad(ctx: Trace): Promise<void> {
    const {engine} = ctx;


    const result = await engine.query(`
      include perfetto module viz.threads;
      include perfetto module viz.summary.threads;
      include perfetto module sched.states;

      select
        utid,
        t.upid,
        tid,
        t.name as threadName,
        is_main_thread as isMainThread,
        is_kernel_thread as isKernelThread
      from _threads_with_kernel_flag t
      join _sched_summary using (utid)
    `);

    const it = result.iter({
      utid: NUM,
      upid: NUM_NULL,
      tid: NUM_NULL,
      threadName: STR_NULL,
      isMainThread: NUM_NULL,
      isKernelThread: NUM,
    });

    for (; it.valid(); it.next()) {
      const {utid, upid, tid, isMainThread, isKernelThread} = it;
      const title_pages = getTrackName({
        utid,
        tid,
        threadName: "alloc_pages",
        kind: THREAD_STATE_TRACK_KIND,
      });

      const title_times = getTrackName({
        utid,
        tid,
        threadName: "alloc_times",
        kind: THREAD_STATE_TRACK_KIND,
      });

      const title_timeout = getTrackName({
        utid,
        tid,
        threadName: "alloc_timeout",
        kind: THREAD_STATE_TRACK_KIND,
      });

      const title_pagefault = getTrackName({
        utid,
        tid,
        threadName: "pagefault",
        kind: THREAD_STATE_TRACK_KIND,
      });

      const uri_pages = uriForThreadStatePageAllocPages(upid, utid);
      const uri_times = uriForThreadStatePageAllocTimes(upid, utid);
      const uri_timeout = uriForThreadStatePageAllocTimeout(upid, utid);
      const uri_pagefault = uriForThreadStatePageFault(upid, utid);

      const track_pages = await createQueryCounterTrack({
        trace: ctx,
        uri:uri_pages,
        data: {
          sqlSource: `
            WITH
            original_data AS (
                SELECT f.ts AS ts, CAST(SUBSTR(a.display_value, 21, 22) AS INTEGER) AS value
                FROM ftrace_event f
                JOIN args a USING(arg_set_id)
                WHERE f.name = 'bpf_trace_printk' 
                  AND a.display_value LIKE 'mm_page_alloc_pages%' 
                  AND f.utid = ${utid}
            ),

            lagged_data AS (
                SELECT 
                    ts, 
                    value,
                    LAG(ts) OVER (ORDER BY ts) AS prev_ts
                FROM original_data
            ),

            insert_points AS (
                SELECT 
                    prev_ts + 10000000 AS new_ts,  -- 直接加 10ms（10,000,000ns）
                    0 AS new_value
                FROM lagged_data
                WHERE prev_ts IS NOT NULL 
                  AND (ts - prev_ts) > 15000000  -- 仅处理间隔超过 15ms 的间隙
            ),

            last_record AS (
                SELECT MAX(ts) AS last_ts  -- 获取原始数据的最后一条时间戳
                FROM original_data
            ),

            last_insert AS (
                SELECT 
                    last_ts + 10000000 AS new_ts1,  -- 最后一条记录后10ms插入的点
                    0 AS new_value1
                FROM last_record
                WHERE last_ts IS NOT NULL  -- 避免原始数据为空的情况
            )

            SELECT ts, value FROM original_data
            UNION ALL
            SELECT new_ts, new_value FROM insert_points  -- 中间间隔插入的点
            UNION ALL
            SELECT new_ts1, new_value1 FROM last_insert  -- 最后一条记录后插入的点
            ORDER BY ts
          `,
        },
      });


      const track_times = await createQueryCounterTrack({
        trace: ctx,
        uri: uri_times,
        data: {
          sqlSource: `
            WITH
            original_data AS (
                SELECT f.ts AS ts, CAST(SUBSTR(a.display_value, 21, 22) AS INTEGER) AS value
                FROM ftrace_event f
                JOIN args a USING(arg_set_id)
                WHERE f.name = 'bpf_trace_printk' 
                  AND a.display_value LIKE 'mm_page_alloc_times%' 
                  AND f.utid = ${utid}
            ),

            lagged_data AS (
                SELECT 
                    ts, 
                    value,
                    LAG(ts) OVER (ORDER BY ts) AS prev_ts
                FROM original_data
            ),

            insert_points AS (
                SELECT 
                    prev_ts + 10000000 AS new_ts,  -- 直接加 10ms（10,000,000ns）
                    0 AS new_value
                FROM lagged_data
                WHERE prev_ts IS NOT NULL 
                  AND (ts - prev_ts) > 15000000  -- 仅处理间隔超过 15ms 的间隙
            ),

            last_record AS (
                SELECT MAX(ts) AS last_ts  -- 获取原始数据的最后一条时间戳
                FROM original_data
            ),

            last_insert AS (
                SELECT 
                    last_ts + 10000000 AS new_ts1,  -- 最后一条记录后10ms插入的点
                    0 AS new_value1
                FROM last_record
                WHERE last_ts IS NOT NULL  -- 避免原始数据为空的情况
            )

            SELECT ts, value FROM original_data
            UNION ALL
            SELECT new_ts, new_value FROM insert_points
            UNION ALL
            SELECT new_ts1, new_value1 FROM last_insert  -- 最后一条记录后插入的点
            ORDER BY ts
          `,
        },
      });

      const track_timeout = await createQueryCounterTrack({
        trace: ctx,
        uri: uri_timeout,
        data: {
          sqlSource: `
            WITH
            original_data AS (
                SELECT f.ts AS ts, CAST(SUBSTR(a.display_value, 21, 22) AS INTEGER) AS value
                FROM ftrace_event f
                JOIN args a USING(arg_set_id)
                WHERE f.name = 'bpf_trace_printk' 
                  AND a.display_value LIKE 'alloc_page_nodemask%' 
                  AND f.utid = ${utid}
            ),

            lagged_data AS (
                SELECT 
                    ts, 
                    value,
                    LAG(ts) OVER (ORDER BY ts) AS prev_ts
                FROM original_data
            ),

            insert_points AS (
                SELECT 
                    prev_ts + 10000000 AS new_ts,  -- 直接加 10ms（10,000,000ns）
                    0 AS new_value
                FROM lagged_data
                WHERE prev_ts IS NOT NULL 
                  AND (ts - prev_ts) > 15000000  -- 仅处理间隔超过 15ms 的间隙
            ),

            last_record AS (
                SELECT MAX(ts) AS last_ts  -- 获取原始数据的最后一条时间戳
                FROM original_data
            ),

            last_insert AS (
                SELECT 
                    last_ts + 10000000 AS new_ts1,  -- 最后一条记录后10ms插入的点
                    0 AS new_value1
                FROM last_record
                WHERE last_ts IS NOT NULL  -- 避免原始数据为空的情况
            )

            SELECT ts, value FROM original_data
            UNION ALL
            SELECT new_ts, new_value FROM insert_points
            UNION ALL
            SELECT new_ts1, new_value1 FROM last_insert  -- 最后一条记录后插入的点
            ORDER BY ts
          `,
        },
      });

      const track_pagefault_slice = await createQuerySliceTrack({
        trace: ctx,
        uri: uri_pagefault,
        data: {
          sqlSource: `
            WITH
            original_data_pagefault AS (
                SELECT 
                  f.ts AS orig_ts, 
                  CAST(SUBSTR(a.display_value, 21, 22) AS INTEGER) AS value,
                  'PF' AS name
                FROM ftrace_event f
                JOIN args a USING(arg_set_id)
                WHERE f.name = 'bpf_trace_printk' 
                  AND a.display_value LIKE 'handle_mm_fault_end%' 
                  AND f.utid = ${utid}
            ),

            original_data_pagefault_filemap AS (
                SELECT 
                  f.ts AS orig_ts, 
                  CAST(SUBSTR(a.display_value, 21, 22) AS INTEGER) AS value,
                  'filemap' AS name
                FROM ftrace_event f
                JOIN args a USING(arg_set_id)
                WHERE f.name = 'bpf_trace_printk' 
                  AND a.display_value LIKE 'filmap_do_fault_end%' 
                  AND f.utid = ${utid}
            )

            SELECT orig_ts - value AS ts, value, name
            FROM original_data_pagefault
            UNION ALL
            SELECT orig_ts - value AS ts, value, name
            FROM original_data_pagefault_filemap
            ORDER BY ts
          `,
          columns: ['ts', 'dur', 'name'],
        },
      });

      ctx.tracks.registerTrack({
        uri:uri_pages,
        title:title_pages,
        tags: {
          kind: THREAD_STATE_TRACK_KIND,
          utid,
          upid: upid ?? undefined,
          ...(isKernelThread === 1 && {kernelThread: true}),
        },
        chips: removeFalsyValues([
          isKernelThread === 0 && isMainThread === 1 && 'main thread',
        ]),
        track: track_pages,
      });

      ctx.tracks.registerTrack({
        uri: uri_times,
        title: title_times,
        tags: {
          kind: THREAD_STATE_TRACK_KIND,
          utid,
          upid: upid ?? undefined,
          ...(isKernelThread === 1 && {kernelThread: true}),
        },
        chips: removeFalsyValues([
          isKernelThread === 0 && isMainThread === 1 && 'main thread',
        ]),
        track: track_times,
      });

      ctx.tracks.registerTrack({
        uri: uri_timeout,
        title: title_timeout,
        tags: {
          kind: THREAD_STATE_TRACK_KIND,
          utid,
          upid: upid ?? undefined,
          ...(isKernelThread === 1 && {kernelThread: true}),
        },
        chips: removeFalsyValues([
          isKernelThread === 0 && isMainThread === 1 && 'main thread',
        ]),
        track: track_timeout,
      });
  
      ctx.tracks.registerTrack({
        uri: uri_pagefault,
        title: title_pagefault,
        tags: {
          kind: THREAD_STATE_TRACK_KIND,
          utid,
          upid: upid ?? undefined,
          ...(isKernelThread === 1 && {kernelThread: true}),
        },
        chips: removeFalsyValues([
          isKernelThread === 0 && isMainThread === 1 && 'main thread',
        ]),
        track: track_pagefault_slice,
      });


      const group = ctx.plugins
        .getPlugin(ProcessThreadGroupsPlugin)
        .getGroupForThread(utid);

      // alloc_pages
      const tracknode_pages = new TrackNode({uri: uri_pages, title: title_pages, sortOrder: 10});
      group?.addChildInOrder(tracknode_pages);

      // alloc_times
      const tracknode_times = new TrackNode({uri: uri_times, title: title_times, sortOrder: 10});
      group?.addChildInOrder(tracknode_times);

      // alloc_timeout
      const tracknode_timeout = new TrackNode({uri: uri_timeout, title: title_timeout, sortOrder: 10});
      group?.addChildInOrder(tracknode_timeout);

      // pagefault
      const tracknode_pagefault = new TrackNode({uri: uri_pagefault, title: title_pagefault, sortOrder: 10});
      group?.addChildInOrder(tracknode_pagefault);

    }
  }
}
