/**
 * /api/open/edgeone —— EdgeOne 站点与加速域名
 *
 * EdgeOne 不是 DNS 记录提供商，端点和语义与 /domains 分开；
 * 所有写操作都会回显 dnspodSync，避免「EdgeOne 成功但 DNS 没生效」被静默吞掉。
 */

import { Router } from 'express';
import { asyncHandler, sendOk } from '../../respond';
import { actorOf, credentialQuery, runIdempotent } from '../helpers';
import {
  applyDomainCertificate,
  createDomain,
  createEdgeOneRecord,
  createSite,
  deleteDomain,
  deleteEdgeOneRecord,
  deleteSite,
  getDomain,
  getDomainCertificate,
  getSite,
  listDomains,
  listEdgeOneRecords,
  listSites,
  setDomainStatus,
  syncSiteDomains,
  updateDomain,
  updateEdgeOneRecord,
  verifySite,
} from '../../edgeone/service';

const router = Router();

// ============ 站点 ============

router.get(
  '/sites',
  asyncHandler(async (req: any, res) => {
    const result = await listSites(
      actorOf(req),
      credentialQuery(req),
      req.apiKey.credentialId,
      req.query.keyword ? String(req.query.keyword) : undefined
    );
    return sendOk(res, result);
  })
);

router.post(
  '/sites',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const result = await createSite(actorOf(req), credentialQuery(req), req.apiKey.credentialId, req.body || {});
      return { status: 201, data: result };
    })
  )
);

router.get(
  '/sites/:site',
  asyncHandler(async (req: any, res) => {
    const result = await getSite(actorOf(req), req.params.site, credentialQuery(req), req.apiKey.credentialId);
    return sendOk(res, result);
  })
);

router.delete(
  '/sites/:site',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const result = await deleteSite(actorOf(req), req.params.site, credentialQuery(req), req.apiKey.credentialId);
      return { status: 200, data: result };
    })
  )
);

router.post(
  '/sites/:site/verify',
  asyncHandler(async (req: any, res) => {
    const result = await verifySite(actorOf(req), req.params.site, credentialQuery(req), req.apiKey.credentialId);
    return sendOk(res, result);
  })
);

// ============ 加速域名 ============

router.get(
  '/sites/:site/domains',
  asyncHandler(async (req: any, res) => {
    const result = await listDomains(
      actorOf(req),
      req.params.site,
      credentialQuery(req),
      req.apiKey.credentialId,
      req.query.keyword ? String(req.query.keyword) : undefined
    );
    return sendOk(res, result);
  })
);

router.post(
  '/sites/:site/domains',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const result = await createDomain(
        actorOf(req),
        req.params.site,
        credentialQuery(req),
        req.apiKey.credentialId,
        req.body || {}
      );
      return { status: 201, data: result };
    })
  )
);

router.post(
  '/sites/:site/domains/upsert',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const actor = actorOf(req);
      const site = req.params.site;
      const body = req.body || {};
      const credentialId = credentialQuery(req);

      try {
        const created = await createDomain(actor, site, credentialId, req.apiKey.credentialId, body);
        return { status: 201, data: { action: 'created', ...created } };
      } catch (error: any) {
        if (error?.code !== 'DOMAIN_ALREADY_EXISTS') throw error;
        const updated = await updateDomain(
          actor,
          site,
          body.name,
          credentialId,
          req.apiKey.credentialId,
          body
        );
        return { status: 200, data: { action: updated.action, ...updated } };
      }
    })
  )
);

router.get(
  '/sites/:site/domains/:name',
  asyncHandler(async (req: any, res) => {
    const result = await getDomain(
      actorOf(req),
      req.params.site,
      req.params.name,
      credentialQuery(req),
      req.apiKey.credentialId
    );
    return sendOk(res, result);
  })
);

router.patch(
  '/sites/:site/domains/:name',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const result = await updateDomain(
        actorOf(req),
        req.params.site,
        req.params.name,
        credentialQuery(req),
        req.apiKey.credentialId,
        req.body || {}
      );
      return { status: 200, data: result };
    })
  )
);

router.patch(
  '/sites/:site/domains/:name/status',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const result = await setDomainStatus(
        actorOf(req),
        req.params.site,
        req.params.name,
        credentialQuery(req),
        req.apiKey.credentialId,
        req.body?.status
      );
      return { status: 200, data: result };
    })
  )
);

router.delete(
  '/sites/:site/domains/:name',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const force = req.query.force === 'true' || req.query.force === '1';
      const result = await deleteDomain(
        actorOf(req),
        req.params.site,
        req.params.name,
        credentialQuery(req),
        req.apiKey.credentialId,
        force
      );
      return { status: 200, data: result };
    })
  )
);

router.get(
  '/sites/:site/domains/:name/certificate',
  asyncHandler(async (req: any, res) => {
    const result = await getDomainCertificate(
      actorOf(req),
      req.params.site,
      req.params.name,
      credentialQuery(req),
      req.apiKey.credentialId
    );
    return sendOk(res, result);
  })
);

router.post(
  '/sites/:site/domains/:name/certificate',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const result = await applyDomainCertificate(
        actorOf(req),
        req.params.site,
        req.params.name,
        credentialQuery(req),
        req.apiKey.credentialId
      );
      return { status: 200, data: result };
    })
  )
);

router.post(
  '/sites/:site/sync',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const result = await syncSiteDomains(
        actorOf(req),
        req.params.site,
        credentialQuery(req),
        req.apiKey.credentialId
      );
      return { status: 200, data: result };
    })
  )
);

// ============ EdgeOne DNS 记录（仅 full / NS 站点） ============

router.get(
  '/sites/:site/records',
  asyncHandler(async (req: any, res) => {
    const result = await listEdgeOneRecords(
      actorOf(req),
      req.params.site,
      credentialQuery(req),
      req.apiKey.credentialId,
      {
        name: req.query.name ? String(req.query.name) : undefined,
        type: req.query.type ? String(req.query.type) : undefined,
      }
    );
    return sendOk(res, result);
  })
);

router.post(
  '/sites/:site/records',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const result = await createEdgeOneRecord(
        actorOf(req),
        req.params.site,
        credentialQuery(req),
        req.apiKey.credentialId,
        req.body || {}
      );
      return { status: 201, data: result };
    })
  )
);

router.put(
  '/sites/:site/records/:recordId',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const result = await updateEdgeOneRecord(
        actorOf(req),
        req.params.site,
        req.params.recordId,
        credentialQuery(req),
        req.apiKey.credentialId,
        req.body || {}
      );
      return { status: 200, data: result };
    })
  )
);

router.delete(
  '/sites/:site/records/:recordId',
  asyncHandler(async (req: any, res) =>
    runIdempotent(req, res, async () => {
      const result = await deleteEdgeOneRecord(
        actorOf(req),
        req.params.site,
        req.params.recordId,
        credentialQuery(req),
        req.apiKey.credentialId
      );
      return { status: 200, data: result };
    })
  )
);

export default router;
