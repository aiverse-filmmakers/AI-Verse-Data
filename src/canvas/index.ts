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
import {DataRecords} from "../records/index.js";
import type {DataActor,JsonObject} from "../protocol/index.js";
import type {DataRecordSnapshot} from "../records/index.js";
import type {DataStorageDatabase} from "../storage/index.js";

const SPACE="creative-canvas",ENTITY="documents";
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TITLE_LIMIT=140,MAX_NODES=150,MAX_EDGES=300;
type Node={id:string;kind:"note";text:string;x:number;y:number};
type Edge={id:string;from:string;to:string};
export type CanvasBoard={nodes:Node[];edges:Edge[]};
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
  |{type:"edge.remove";id:string};

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
  if(Object.keys(b).sort().join(",")!=="edges,nodes"
    ||!Array.isArray(b.nodes)||!Array.isArray(b.edges)
    ||b.nodes.length>MAX_NODES||b.edges.length>MAX_EDGES)
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
  return {nodes,edges:links};
}
function view(r:DataRecordSnapshot):CanvasDocument{
  return {id:r.recordId,title:title(r.data.title),board:boardValue(r.data.board),
    version:r.version,createdAt:r.createdAt,updatedAt:r.updatedAt};
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
  readonly scope:{kind:"workspace"|"standalone";workspaceId:string};
  constructor(db:DataStorageDatabase){
    const binding=db.metadata().binding;
    if(!binding || !["workspace","standalone"].includes(binding.kind)
      ||typeof binding.workspaceId!=="string"||!binding.workspaceId)
      fail("CANVAS_TRUSTED_SCOPE_REQUIRED");
    this.scope={kind:binding.kind,workspaceId:binding.workspaceId};
    this.catalog=new DataCatalog(db);
    this.records=new DataRecords(db);
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
        ||JSON.stringify(existing.fields)!==JSON.stringify(schema().fields))
        fail("CANVAS_SCHEMA_CONFLICT");
    }
  }
  /** All actor identities and scope grants must come from a trusted caller. */
  create(input:{title:string;actor:DataActor;idempotencyKey:string}):CanvasDocument{
    validId(input.idempotencyKey);
    return view(this.records.create({spaceId:SPACE,entity:ENTITY,
      actor:input.actor,idempotencyKey:input.idempotencyKey,
      data:{title:title(input.title),board:{nodes:[],edges:[]}}}));
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
      default:fail("CANVAS_EDIT_UNSUPPORTED");
    }
    return this.patch(input,{board:board as unknown as JsonObject});
  }
  delete(input:{id:string;expectedVersion:number;actor:DataActor;idempotencyKey:string}):CanvasDocument{
    validId(input.id);validId(input.idempotencyKey);
    if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)
      fail("CANVAS_VERSION_INVALID");
    const result=this.records.softDelete({spaceId:SPACE,entity:ENTITY,
      recordId:input.id,expectedVersion:input.expectedVersion,
      actor:input.actor,idempotencyKey:input.idempotencyKey,
      reason:"user-deleted-canvas"});
    return view(result);
  }
  private patch(input:{id:string;expectedVersion:number;actor:DataActor;idempotencyKey:string},
    patch:JsonObject):CanvasDocument{
    validId(input.id);validId(input.idempotencyKey);
    if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)
      fail("CANVAS_VERSION_INVALID");
    return view(this.records.update({spaceId:SPACE,entity:ENTITY,
      recordId:input.id,expectedVersion:input.expectedVersion,
      idempotencyKey:input.idempotencyKey,actor:input.actor,patch}));
  }
}
