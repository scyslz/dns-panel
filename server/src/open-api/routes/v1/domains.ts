/**
 * /api/open/domains —— DNS 域名与记录
 *
 * 域名优先寻址：调用方只传域名，zoneId 由服务端解析。
 * /records/upsert、/records/batch 必须定义在 /records/:recordId 之前。
 */

import { Router } from 'express';
import { asyncHandler, sendOk } from '../../respond';
import { actorOf, credentialQuery, runIdempotent } from '../helpers';
import {
  createRecord,
  deleteRecordById,
  deleteRecordsByMatch,
  getCapabilitiesForDomain,
  getRecordDetail,
  getZoneDetail,
  listLines,
  listRecords,
  listZones,
  runBatch,
  setRecordStatus,
  updateRecord,
  upsertRecord,
} from '../../dns/service';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req: any, res) => {
    const result = await listZones(actorOf(req), credentialQuery(req), req.apiKey.credentialId, {
      keyword: req.query.keyword ? String(req.query.keyword) : undefined,
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 20,
    });
    return sendOk(res, result);
  })
);

router.get(
  '/:domain',
  asyncHandler(async (req: any, res) => {
    const result = await getZoneDetail(actorOf(req), req.params.domain, credentialQuery(req), req.apiKey.credentialId);
    return sendOk(res, result);
  })
);

router.get(
  '/:domain/capabilities',
  asyncHandler(async (req: any, res) => {
    const result = await getCapabilitiesForDomain(
      actorOf(req),
      req.params.domain,
      credentialQuery(req),
      req.apiKey.credentialId
    );
    return sendOk(res, result);
  })
);

router.get(
  '/:domain/lines',
  asyncHandler(async (req: any, res) => {
    const result = await listLines(actorOf(req), req.params.domain, credentialQuery(req), req.apiKey.credentialId);
    return sendOk(res, result);
  })
);

router.get(
  '/:domain/records',
  asyncHandler(async (req: any, res) => {
    const result = await listRecords(
      actorOf(req),
      req.params.domain,
      credentialQuery(req),
      req.apiKey.credentialId,
      {
        name: req.query.name ? String(req.query.name) : undefined,
        type: req.query.type ? String(req.query.type) : undefined,
        value: req.query.value !== undefined ? String(req.query.value) : undefined,
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.pageSize) || 20,
      }
    );
    return sendOk(res, result);
  })
);

router.post(
  '/:domain/records',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const result = await createRecord(
        actorOf(req),
        req.params.domain,
        credentialQuery(req),
        req.apiKey.credentialId,
        req.body || {}
      );
      return { status: 201, data: result };
    })
  )
);

router.post(
  '/:domain/records/upsert',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const result = await upsertRecord(
        actorOf(req),
        req.params.domain,
        credentialQuery(req),
        req.apiKey.credentialId,
        req.body || {}
      );
      return { status: 200, data: result };
    })
  )
);

router.post(
  '/:domain/records/batch',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const body = req.body || {};
      if (body.atomic === true) {
        const error: any = new Error('atomic 批量暂不支持（厂商侧无事务回滚），请使用默认的逐条执行');
        error.httpStatus = 400;
        error.code = 'NOT_IMPLEMENTED';
        throw error;
      }
      const result = await runBatch(
        actorOf(req),
        req.params.domain,
        credentialQuery(req),
        req.apiKey.credentialId,
        body.operations || []
      );
      return { status: 200, data: result };
    })
  )
);

router.get(
  '/:domain/records/:recordId',
  asyncHandler(async (req: any, res) => {
    const result = await getRecordDetail(
      actorOf(req),
      req.params.domain,
      req.params.recordId,
      credentialQuery(req),
      req.apiKey.credentialId
    );
    return sendOk(res, result);
  })
);

router.patch(
  '/:domain/records/:recordId',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const result = await updateRecord(
        actorOf(req),
        req.params.domain,
        req.params.recordId,
        credentialQuery(req),
        req.apiKey.credentialId,
        req.body || {},
        'patch'
      );
      return { status: 200, data: result };
    })
  )
);

router.put(
  '/:domain/records/:recordId',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const result = await updateRecord(
        actorOf(req),
        req.params.domain,
        req.params.recordId,
        credentialQuery(req),
        req.apiKey.credentialId,
        req.body || {},
        'put'
      );
      return { status: 200, data: result };
    })
  )
);

router.patch(
  '/:domain/records/:recordId/status',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const enabled = req.body?.enabled;
      if (typeof enabled !== 'boolean') {
        const error: any = new Error('缺少参数: enabled（boolean）');
        error.httpStatus = 400;
        throw error;
      }
      const result = await setRecordStatus(
        actorOf(req),
        req.params.domain,
        req.params.recordId,
        credentialQuery(req),
        req.apiKey.credentialId,
        enabled
      );
      return { status: 200, data: result };
    })
  )
);

router.delete(
  '/:domain/records/:recordId',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const result = await deleteRecordById(
        actorOf(req),
        req.params.domain,
        req.params.recordId,
        credentialQuery(req),
        req.apiKey.credentialId
      );
      return { status: 200, data: result };
    })
  )
);

router.delete(
  '/:domain/records',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const result = await deleteRecordsByMatch(
        actorOf(req),
        req.params.domain,
        credentialQuery(req),
        req.apiKey.credentialId,
        {
          name: req.query.name ? String(req.query.name) : undefined,
          type: req.query.type ? String(req.query.type) : undefined,
          value: req.query.value !== undefined ? String(req.query.value) : undefined,
          line: req.query.line !== undefined ? String(req.query.line) : undefined,
          all: req.query.all === 'true' || req.query.all === '1',
        }
      );
      return { status: 200, data: result };
    })
  )
);

export default router;
