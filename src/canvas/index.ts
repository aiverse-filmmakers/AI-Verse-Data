/**
 * Data-owned Canvas documents v1. Every mutation uses the existing scoped
 * canonical Data record engine: optimistic versions, idempotency, provenance
 * and soft deletion. Browser/Dashboard never instantiate this against paths.
 *
 * IMPORTANT: caller must already be an authorized trusted host and must pass
 * a DataStorageDatabase opened through the trusted scoped Data interface.
 * This package does not grant actor authority or expose an HTTP endpoint.
 */
import {DataCatalog} from "../catalog/index.js";
import {canonicalSchemaJson} from "../catalog/canonical.js";
import {DataRecords} from "../records/index.js";
import {DataIdempotency} from "../idempotency/index.js";
import {createHash} from "node:crypto";
import type {DataActor,JsonObject} from "../protocol/index.js";
import type {DataRecordSnapshot} from "../records/index.js";
import type {DataStorageDatabase} from "../storage/index.js";

const SPACE="creative-canvas",ENTITY="documents",REVISIONS="revisions";
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TITLE_LIMIT=140,MAX_NODES=150,MAX_EDGES=300,MAX_GROUPS=50;
type Node={id:string;kind:"note";text:string;x:number;y:number};
type Edge={id:string;from:string;to:string};
type Group={id:string;label:string;nodeIds:string[]};
/**
 * Existing v1 boards remain a canonical two-field shape. New grouped boards
 * use the optional third field; do not add empty groups to v1 revisions,
 * since historical Canvas digests must remain bit-for-bit stable.
 */
export type CanvasBoard={nodes:Node[];edges:Edge[];groups?:Group[]};
export type CanvasDocument={
  id:string;title:string;version:number;createdAt:string;updatedAt:string;
  board:CanvasBoard;
};
export type CanvasEdit=
  |{type:"note.add";id:string;text:string;x:number;y:number}
  |{type:"note.move";id:string;x:number;y:number}
  |{type:"note.text";id:string;text:string}
  |{type:"note.remove";id:string}
  |{type:"edge.add";id:string;from:string;to:string}
  |{type:"edge.remove";id:string}
  |{type:"group.create";id:string;label:string;nodeIds:string[]}
  |{type:"group.rename";id:string;label:string}
  |{type:"group.members";id:string;nodeIds:string[]}
  |{type:"group.move";id:string;dx:number;dy:number}
  |{type:"group.remove";id:string};

export class CanvasDocumentError extends Error{
  constructor(readonly code:string){
    super(code);this.name="CanvasDocumentError";
  }
}
function fail(code:string):never{throw new CanvasDocumentError(code)}
function validId(x:unknown):asserts x is string{
  if(typeof x!=="string"||!ID.test(x))fail("CANVAS_ID_INVALID");
}
function title(x:unknown):string{
  if(typeof x!=="string"||x.trim().length<1||x.length>TITLE_LIMIT)
    fail("CANVAS_TITLE_INVALID");
  return x.trim();
}
function textValue(x:unknown):string{
  if(typeof x!=="string"||x.length>5000)fail("CANVAS_TEXT_INVALID");
  return x;
}
function point(v:unknown):number{
  if(typeof v!=="number"||!Number.isFinite(v)||Math.abs(v)>100000)
    fail("CANVAS_POSITION_INVALID");
  return v;
}
function boardValue(value:unknown):CanvasBoard{
  if(!value||typeof value!=="object"||Array.isArray(value))
    fail("CANVAS_BOARD_INVALID");
  const b=value as Record<string,unknown>;
  const fields=Object.keys(b).sort().join(",");
  if(!["edges,nodes","edges,groups,nodes"].includes(fields)
    ||!Array.isArray(b.nodes)||!Array.isArray(b.edges)
    ||b.nodes.length>MAX_NODES||b.edges.length>MAX_EDGES
    ||(b.groups!==undefined&&(!Array.isArray(b.groups)||b.groups.length>MAX_GROUPS)))
    fail("CANVAS_BOARD_INVALID");
  const ids=new Set<string>();
  const nodes:Node[]=b.nodes.map(value=>{
    if(!value||typeof value!=="object"||Array.isArray(value))
      fail("CANVAS_BOARD_INVALID");
    const n=value as Record<string,unknown>;
    if(Object.keys(n).sort().join(",")!=="id,kind,text,x,y"
      ||n.kind!=="note")fail("CANVAS_BOARD_INVALID");
    validId(n.id);if(ids.has(n.id))fail("CANVAS_BOARD_INVALID");
    ids.add(n.id);
    return {id:n.id,kind:"note",text:textValue(n.text),x:point(n.x),y:point(n.y)};
  });
  const edges=new Set<string>();
  const links:Edge[]=b.edges.map(value=>{
    if(!value||typeof value!=="object"||Array.isArray(value))
      fail("CANVAS_BOARD_INVALID");
    const e=value as Record<string,unknown>;
    if(Object.keys(e).sort().join(",")!=="from,id,to")
      fail("CANVAS_BOARD_INVALID");
    validId(e.id);validId(e.from);validId(e.to);
    if(edges.has(e.id)||e.from===e.to||!ids.has(e.from)||!ids.has(e.to))
      fail("CANVAS_BOARD_INVALID");
    edges.add(e.id);return {id:e.id,from:e.from,to:e.to};
  });
  if(b.groups===undefined)return {nodes,edges:links};
  const groupIds=new Set<string>(),assigned=new Set<string>();
  const groups:Group[]=b.groups.map(value=>{
    if(!value||typeof value!=="object"||Array.isArray(value))
      fail("CANVAS_BOARD_INVALID");
    const g=value as Record<string,unknown>;
    if(Object.keys(g).sort().join(",")!=="id,label,nodeIds"
      ||!Array.isArray(g.nodeIds)||g.nodeIds.length<2
      ||g.nodeIds.length>MAX_NODES
      ||typeof g.label!=="string"||g.label.trim().length<1||g.label.length>80)
      fail("CANVAS_BOARD_INVALID");
    validId(g.id);
    if(groupIds.has(g.id)||ids.has(g.id)||edges.has(g.id))
      fail("CANVAS_BOARD_INVALID");
    groupIds.add(g.id);
    const memberIds=new Set<string>();
    for(const nodeId of g.nodeIds){
      validId(nodeId);
      if(!ids.has(nodeId)||memberIds.has(nodeId)||assigned.has(nodeId))
        fail("CANVAS_BOARD_INVALID");
      memberIds.add(nodeId);assigned.add(nodeId);
    }
    return {id:g.id,label:g.label.trim(),nodeIds:[...memberIds]};
  });
  return {nodes,edges:links,groups};
}
function view(r:DataRecordSnapshot):CanvasDocument{
  return {id:r.recordId,title:title(r.data.title),board:boardValue(r.data.board),
    version:r.version,createdAt:r.createdAt,updatedAt:r.updatedAt};
}
function revisionSchema(){
  return {
    spaceId:SPACE,entity:REVISIONS,name:"Canvas Revision Snapshots",
    fields:{
      documentId:{type:"string" as const,required:true,minLength:1,maxLength:128},
      documentVersion:{type:"integer" as const,required:true,min:1},
      title:{type:"string" as const,required:true,minLength:1,maxLength:TITLE_LIMIT},
      board:{type:"json" as const,required:true},
      createdAt:{type:"string" as const,required:true,minLength:1,maxLength:40},
      updatedAt:{type:"string" as const,required:true,minLength:1,maxLength:40},
      digest:{type:"string" as const,required:true,minLength:64,maxLength:64},
    },
  };
}
function digestOf(s:CanvasDocument):string{
  return createHash("sha256").update(JSON.stringify({
    id:s.id,version:s.version,title:s.title,board:boardValue(s.board),
    createdAt:s.createdAt,updatedAt:s.updatedAt,
  })).digest("hex");
}
function archivalKey(id:string,version:number):string{
  return createHash("sha256").update("canvas.revision:"+id+":"+version).digest("hex");
}
function revisionOf(raw:JsonObject):CanvasDocument{
  const id=raw.documentId,version=raw.documentVersion;
  validId(id);
  if(!Number.isSafeInteger(version)||(version as number)<1
    ||typeof raw.createdAt!=="string"||typeof raw.updatedAt!=="string")
    fail("CANVAS_HISTORY_INVALID");
  const value:CanvasDocument={id,title:title(raw.title),version:version as number,
    board:boardValue(raw.board),createdAt:raw.createdAt,updatedAt:raw.updatedAt};
  if(raw.digest!==digestOf(value))fail("CANVAS_HISTORY_INVALID");
  return value;
}
function schema(){
  return {
    spaceId:SPACE,entity:ENTITY,name:"Canvas Documents",
    fields:{
      title:{type:"string" as const,required:true,minLength:1,maxLength:TITLE_LIMIT},
      board:{type:"json" as const,required:true},
    },
  };
}
export class CanvasDocuments{
  private readonly catalog:DataCatalog;
  private readonly records:DataRecords;
  private readonly idempotency:DataIdempotency;
  readonly scope:{kind:"workspace"|"standalone";workspaceId:string};
  constructor(private readonly db:DataStorageDatabase){
    const binding=db.metadata().binding;
    if(!binding || !["workspace","standalone"].includes(binding.kind)
      ||typeof binding.workspaceId!=="string"||!binding.workspaceId)
      fail("CANVAS_TRUSTED_SCOPE_REQUIRED");
    this.scope={kind:binding.kind,workspaceId:binding.workspaceId};
    this.catalog=new DataCatalog(db);
    this.records=new DataRecords(db);
    this.idempotency=new DataIdempotency(db);
    const existingSpace=this.catalog.listSpaces().find(x=>x.spaceId===SPACE);
    if(!existingSpace)this.catalog.createSpace({
      spaceId:SPACE,name:"Creative Canvas",authority:"local_canonical",
    });
    else if(existingSpace.authority!=="local_canonical")
      fail("CANVAS_SCHEMA_CONFLICT");
    const entity=this.catalog.listSchemas(SPACE).find(x=>x.entity===ENTITY);
    if(!entity)this.catalog.createSchema(schema());
    else{
      const existing=this.catalog.getSchema(SPACE,ENTITY);
      if(existing.allowUnknownFields===true
        ||canonicalSchemaJson({...schema(),fields:existing.fields})!==canonicalSchemaJson(schema()))
        fail("CANVAS_SCHEMA_CONFLICT");
    }
    const revision=this.catalog.listSchemas(SPACE).find(x=>x.entity===REVISIONS);
    if(!revision)this.catalog.createSchema(revisionSchema());
    else{
      const existing=this.catalog.getSchema(SPACE,REVISIONS);
      if(existing.allowUnknownFields===true
        ||canonicalSchemaJson({...revisionSchema(),fields:existing.fields})!==canonicalSchemaJson(revisionSchema()))
        fail("CANVAS_SCHEMA_CONFLICT");
    }
  }
  /**
   * Immutable-by-Canvas-API full version snapshot. Data's canonical record
   * engine stores this in the SAME scoped SQLite transaction as mutation.
   * Existing pre-history docs are captured at their next authorized write.
   */
  private archive(document:CanvasDocument):void{
    // The archival actor belongs to the version being archived, NOT the
    // newly admitted writer. This allows a human-created revision to remain
    // stable when an agent later edits the same document.
    const canonical=this.records.get({spaceId:SPACE,entity:ENTITY,recordId:document.id});
    if(digestOf(view(canonical))!==digestOf(document))
      fail("CANVAS_HISTORY_INVALID");
    const actor=canonical.updatedBy;
    const data:JsonObject={documentId:document.id,
      documentVersion:document.version,title:document.title,
      board:boardValue(document.board) as unknown as JsonObject,
      createdAt:document.createdAt,updatedAt:document.updatedAt,
      digest:digestOf(document)};
    this.records.create({spaceId:SPACE,entity:REVISIONS,
      actor,idempotencyKey:archivalKey(document.id,document.version),data});
  }
  private decodeRevision(record:{dataJson:string;version:number;
    createdActorKind:string;createdActorId:string;
    updatedActorKind:string;updatedActorId:string}):CanvasDocument{
    // A historical snapshot must itself be a first-generation immutable
    // Data record, not a later changed row or arbitrary JSON payload.
    if(record.version!==1||record.createdActorKind!==record.updatedActorKind
      ||record.createdActorId!==record.updatedActorId)
      fail("CANVAS_HISTORY_INVALID");
    let value:JsonObject;
    try{value=JSON.parse(record.dataJson) as JsonObject;}
    catch{fail("CANVAS_HISTORY_INVALID");}
    return revisionOf(value);
  }
  private revisions(id:string,limit:number,beforeVersion?:number):CanvasDocument[]{
    validId(id);
    const rows=this.db.recordStorage().listCanvasRevisionRecords(
      id,limit,beforeVersion);
    const out=rows.map(row=>this.decodeRevision(row));
    const seen=new Set<number>();
    for(const snapshot of out){
      if(snapshot.id!==id||seen.has(snapshot.version)
        ||(beforeVersion!==undefined&&snapshot.version>=beforeVersion))
        fail("CANVAS_HISTORY_INVALID");
      seen.add(snapshot.version);
    }
    for(let i=1;i<out.length;i++){
      if(out[i]!.version>=out[i-1]!.version)fail("CANVAS_HISTORY_INVALID");
    }
    return out;
  }
  /** Bounded, indexed, descending keyset pages. No workspace-wide scans. */
  history(id:string,limit=20,beforeVersion?:number):CanvasDocument[]{
    this.get(id); // Deleted and foreign workspace records remain hidden.
    if(!Number.isSafeInteger(limit)||limit<1||limit>30
      ||(beforeVersion!==undefined&&
        (!Number.isSafeInteger(beforeVersion)||beforeVersion<=1)))
      fail("CANVAS_PAGE_INVALID");
    return this.revisions(id,limit,beforeVersion);
  }
  /** Revert is a NEW version, never an edit to the immutable older snapshot. */
  revert(input:{id:string;toVersion:number;expectedVersion:number;
    actor:DataActor;idempotencyKey:string}):CanvasDocument{
    validId(input.id);validId(input.idempotencyKey);
    if(!Number.isSafeInteger(input.toVersion)||input.toVersion<1
      ||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)
      fail("CANVAS_VERSION_INVALID");
    return this.db.transaction(()=>{
      const request={id:input.id,toVersion:input.toVersion,
        expectedVersion:input.expectedVersion};
      const replay=this.idempotency.prepare<CanvasDocument>(input.idempotencyKey,
        "canvas.revert",input.actor,request);
      if(replay.kind==="replay")return replay.value;
      const current=this.get(input.id);
      if(current.version!==input.expectedVersion)fail("RECORD_VERSION_CONFLICT");
      if(input.toVersion>=current.version)fail("CANVAS_VERSION_INVALID");
      const matched=this.db.recordStorage().getCanvasRevisionRecords(
        input.id,input.toVersion);
      if(matched.length>1)fail("CANVAS_HISTORY_INVALID");
      if(matched.length===0)fail("CANVAS_HISTORY_UNAVAILABLE");
      const source=this.decodeRevision(matched[0]!);
      if(source.id!==input.id||source.version!==input.toVersion)
        fail("CANVAS_HISTORY_INVALID");
      this.archive(current);
      const saved=view(this.records.update({spaceId:SPACE,entity:ENTITY,
        recordId:input.id,expectedVersion:current.version,actor:input.actor,
        idempotencyKey:createHash("sha256").update("canvas.revert.record:"+
          input.idempotencyKey).digest("hex"),
        patch:{title:source.title,board:boardValue(source.board) as unknown as JsonObject}}));
      this.archive(saved);
      return this.idempotency.complete(input.idempotencyKey,"canvas.revert",
        replay.requestFingerprint,saved);
    },"immediate");
  }
  /** All actor identities and scope grants must come from a trusted caller. */
  create(input:{title:string;actor:DataActor;idempotencyKey:string}):CanvasDocument{
    validId(input.idempotencyKey);
    return this.db.transaction(()=>{
      const saved=view(this.records.create({spaceId:SPACE,entity:ENTITY,
        actor:input.actor,idempotencyKey:input.idempotencyKey,
        data:{title:title(input.title),board:{nodes:[],edges:[]}}}));
      this.archive(saved);
      return saved;
    },"immediate");
  }
  /**
   * One atomic Data-owned clone, including all notes and connections.
   * Source version, full board and clone receipt are bound in one SQLite
   * transaction, not a series of Dashboard note.add calls.
   */
  duplicate(input:{id:string;expectedVersion:number;title?:string;
    actor:DataActor;idempotencyKey:string}):CanvasDocument{
    validId(input.id);validId(input.idempotencyKey);
    if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)
      fail("CANVAS_VERSION_INVALID");
    const requestedTitle=input.title===undefined?undefined:title(input.title);
    return this.db.transaction(()=>{
      const request={sourceId:input.id,expectedVersion:input.expectedVersion,
        ...(requestedTitle===undefined?{}:{title:requestedTitle})};
      const replay=this.idempotency.prepare<CanvasDocument>(input.idempotencyKey,
        "canvas.duplicate",input.actor,request);
      if(replay.kind==="replay")return replay.value;
      const source=this.get(input.id);
      if(source.version!==input.expectedVersion)fail("RECORD_VERSION_CONFLICT");
      const copiedTitle=requestedTitle??title(source.title.slice(0,135)+" copy");
      const copied=this.records.create({spaceId:SPACE,entity:ENTITY,
        actor:input.actor,
        // Independent namespace. This is still one authoritative Data record.
        idempotencyKey:createHash("sha256").update("canvas.duplicate.record:"+
          input.idempotencyKey).digest("hex"),
        data:{title:copiedTitle,board:boardValue(source.board) as unknown as JsonObject},
      });
      const saved=view(copied);
      this.archive(saved);
      return this.idempotency.complete(input.idempotencyKey,
        "canvas.duplicate",replay.requestFingerprint,saved);
    },"immediate");
  }
  list(limit=50):CanvasDocument[]{
    if(!Number.isSafeInteger(limit)||limit<1||limit>200)
      fail("CANVAS_PAGE_INVALID");
    return this.records.list({spaceId:SPACE,entity:ENTITY,limit}).map(view);
  }
  get(id:string):CanvasDocument{
    validId(id);
    return view(this.records.get({spaceId:SPACE,entity:ENTITY,recordId:id}));
  }
  rename(input:{id:string;title:string;expectedVersion:number;actor:DataActor;idempotencyKey:string}):CanvasDocument{
    return this.patch(input,{title:title(input.title)});
  }
  edit(input:{id:string;edit:CanvasEdit;expectedVersion:number;actor:DataActor;idempotencyKey:string}):CanvasDocument{
    validId(input.id);validId(input.idempotencyKey);
    if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)
      fail("CANVAS_VERSION_INVALID");
    // Preserve original Canvas validation errors for non-finite numeric
    // inputs before the Data idempotency fingerprint parser runs.
    if(input.edit.type==="note.add"||input.edit.type==="note.move"){
      point(input.edit.x);point(input.edit.y);
    }else if(input.edit.type==="group.move"){
      point(input.edit.dx);point(input.edit.dy);
    }
    return this.db.transaction(()=>{
      // Whole-edit replay MUST precede board mutation validation. Otherwise
      // replaying a committed group.create would report GROUP_CONFLICT even
      // though Data's record was already successfully written.
      const fingerprint={id:input.id,expectedVersion:input.expectedVersion,
        edit:input.edit as unknown as JsonObject};
      const intentKey=createHash("sha256").update("canvas.edit.intent:"+
        input.idempotencyKey).digest("hex");
      const replay=this.idempotency.prepare<CanvasDocument>(intentKey,
        "canvas.edit",input.actor,fingerprint);
      if(replay.kind==="replay")return replay.value;
      const result=this.editOnce(input);
      return this.idempotency.complete(intentKey,"canvas.edit",
        replay.requestFingerprint,result);
    },"immediate");
  }
  private editOnce(input:{id:string;edit:CanvasEdit;expectedVersion:number;actor:DataActor;idempotencyKey:string}):CanvasDocument{
    const before=this.get(input.id);
    const board=boardValue(before.board);
    const op=input.edit;
    validId(op.id);
    switch(op.type){
      case "note.add":
        if(board.nodes.length>=MAX_NODES||board.nodes.some(n=>n.id===op.id)||board.edges.some(e=>e.id===op.id))
          fail("CANVAS_NODE_CONFLICT");
        board.nodes.push({id:op.id,kind:"note",text:textValue(op.text),x:point(op.x),y:point(op.y)});
        break;
      case "note.move":{
        const note=board.nodes.find(n=>n.id===op.id);
        if(!note)fail("CANVAS_NODE_NOT_FOUND");
        note.x=point(op.x);note.y=point(op.y);break;
      }
      case "note.text":{
        const note=board.nodes.find(n=>n.id===op.id);
        if(!note)fail("CANVAS_NODE_NOT_FOUND");
        note.text=textValue(op.text);break;
      }
      case "note.remove":{
        if(!board.nodes.some(n=>n.id===op.id))fail("CANVAS_NODE_NOT_FOUND");
        board.nodes=board.nodes.filter(n=>n.id!==op.id);
        board.edges=board.edges.filter(e=>e.from!==op.id&&e.to!==op.id);
        if(board.groups){
          board.groups=board.groups.map(g=>({
            ...g,nodeIds:g.nodeIds.filter(n=>n!==op.id),
          })).filter(g=>g.nodeIds.length>=2);
        }
        break;
      }
      case "edge.add":
        validId(op.from);validId(op.to);
        if(board.edges.length>=MAX_EDGES||board.edges.some(e=>e.id===op.id)||board.nodes.some(n=>n.id===op.id)
          ||op.from===op.to||!board.nodes.some(n=>n.id===op.from)||!board.nodes.some(n=>n.id===op.to))
          fail("CANVAS_EDGE_CONFLICT");
        board.edges.push({id:op.id,from:op.from,to:op.to});break;
      case "edge.remove":
        if(!board.edges.some(e=>e.id===op.id))fail("CANVAS_EDGE_NOT_FOUND");
        board.edges=board.edges.filter(e=>e.id!==op.id);break;
      case "group.create": {
        const groups=board.groups??[];
        if(groups.length>=MAX_GROUPS||groups.some(g=>g.id===op.id)
          ||board.nodes.some(n=>n.id===op.id)||board.edges.some(e=>e.id===op.id))
          fail("CANVAS_GROUP_CONFLICT");
        groups.push({id:op.id,label:op.label,nodeIds:op.nodeIds});
        board.groups=groups;
        break;
      }
      case "group.rename": {
        const group=board.groups?.find(g=>g.id===op.id);
        if(!group)fail("CANVAS_GROUP_NOT_FOUND");
        group.label=op.label;break;
      }
      case "group.members": {
        const group=board.groups?.find(g=>g.id===op.id);
        if(!group)fail("CANVAS_GROUP_NOT_FOUND");
        group.nodeIds=op.nodeIds;break;
      }
      case "group.move": {
        const group=board.groups?.find(g=>g.id===op.id);
        if(!group)fail("CANVAS_GROUP_NOT_FOUND");
        const dx=point(op.dx),dy=point(op.dy);
        for(const note of board.nodes){
          if(group.nodeIds.includes(note.id)){
            note.x=point(note.x+dx);
            note.y=point(note.y+dy);
          }
        }
        break;
      }
      case "group.remove":
        if(!board.groups?.some(g=>g.id===op.id))fail("CANVAS_GROUP_NOT_FOUND");
        board.groups=board.groups.filter(g=>g.id!==op.id);
        break;
      default:fail("CANVAS_EDIT_UNSUPPORTED");
    }
    // Re-validate the entire board before its canonical Data transaction;
    // this covers cross-group membership conflicts and ensures no partial
    // movement or malformed group escapes into SQLite.
    return this.patch(input,{board:boardValue(board) as unknown as JsonObject});
  }
  delete(input:{id:string;expectedVersion:number;actor:DataActor;idempotencyKey:string}):CanvasDocument{
    validId(input.id);validId(input.idempotencyKey);
    if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)
      fail("CANVAS_VERSION_INVALID");
    return this.db.transaction(()=>{
      const existing=this.get(input.id);
      if(existing.version!==input.expectedVersion)fail("RECORD_VERSION_CONFLICT");
      this.archive(existing);
      const result=this.records.softDelete({spaceId:SPACE,entity:ENTITY,
        recordId:input.id,expectedVersion:input.expectedVersion,
        actor:input.actor,idempotencyKey:input.idempotencyKey,
        reason:"user-deleted-canvas"});
      return view(result);
    },"immediate");
  }
  private patch(input:{id:string;expectedVersion:number;actor:DataActor;idempotencyKey:string},
    patch:JsonObject):CanvasDocument{
    validId(input.id);validId(input.idempotencyKey);
    if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)
      fail("CANVAS_VERSION_INVALID");
    return this.db.transaction(()=>{
      const existing=this.get(input.id);
      if(existing.version!==input.expectedVersion)fail("RECORD_VERSION_CONFLICT");
      this.archive(existing);
      const updated=view(this.records.update({spaceId:SPACE,entity:ENTITY,
        recordId:input.id,expectedVersion:input.expectedVersion,
        idempotencyKey:input.idempotencyKey,actor:input.actor,patch}));
      this.archive(updated);
      return updated;
    },"immediate");
  }
}
