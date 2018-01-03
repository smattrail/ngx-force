import {Injectable, NgZone} from '@angular/core';
import { HttpClient, HttpClientModule, HttpHeaders , HttpParams, HttpErrorResponse} from '@angular/common/http';
import { Observable } from 'rxjs/Observable';
import 'rxjs/add/observable/of';
import 'rxjs/add/observable/empty';
import 'rxjs/add/operator/catch';

export interface oAuthToken{
  id: string;
  issued_at: string;
  instance_url: string;
  signature: string;
  access_token: string;
  refresh_token: string;
  token_type: string;
  scope: string;
}

@Injectable()
export class Force {
    private loginURL: string = 'https://test.salesforce.com';
    private scopeParameters: Array<string> = ['full'];
    private appId: string = '3MVG9g9rbsTkKnAXo4ihKyh8njSqASdomboUgxbd2w95IR24VPq5UVjwmiVhvnOGML4m_fjW7d6ZoeWl5V4Fu';
    private apiVersion: string = 'v42.0';
    private oauth: oAuthToken;
    private tokenStore: any = {};
    private context: string = window.location.pathname.substring(0, window.location.pathname.lastIndexOf("/"));
    private serverURL: string = window.location.protocol + '//' + window.location.hostname + (window.location.port ? ':' + window.location.port : '');
    private baseURL: string = this.serverURL + this.context;
    private proxyURL: string = this.baseURL;
    private oauthCallbackURL: string = this.baseURL + '/oauthcallback.html';
    private useProxy: boolean = (!((<any>window).cordova || (<any>window).SfdcApp));
    private loginURLWindow = this.loginURL + '/services/oauth2/authorize?client_id='+ this.appId + '&redirect_uri=' + this.oauthCallbackURL+ '&response_type=token&scope=' + this.scopeParameters.join('%20');
    
    private deferredLogin: {
        resolve: any,
        reject: any
    };
    private onlyOne: boolean = true;
    public init(params: any) {
        if (params) {
            this.appId = params.appId || this.appId;
            this.apiVersion = params.apiVersion || this.apiVersion;
            this.loginURL = params.loginURL || this.loginURL;
            this.oauthCallbackURL = params.oauthCallbackURL || this.oauthCallbackURL;
            this.proxyURL = params.proxyURL || this.proxyURL;
            this.useProxy = params.useProxy === undefined ? this.useProxy : params.useProxy;
            if (params.accessToken) {
                if (!this.oauth) this.oauth = <oAuthToken>{};
                this.oauth.access_token = params.accessToken;
            }

            if (params.instanceURL) {
                if (!this.oauth) this.oauth = <oAuthToken>{};
                this.oauth.instance_url = params.instanceURL;
            }

            if (params.refreshToken) {
                if (!this.oauth) this.oauth = <oAuthToken>{};
                this.oauth.refresh_token = params.refreshToken;
            }
        }
    }

    public login() : Observable<Object> {
        if ((<any>window).cordova) return this.loginWithDevice()
        return this.loginWithBrowser();
    }

    private loginWithBrowser() : Observable<Object> {
        window.open(this.loginURLWindow, '_blank', 'location=no');
        return Observable.empty<Object>();      
    }

    private loginWithDevice() : Observable<Object>{
      const deviceOauthCallback:string = this.loginURL + '/services/oauth2/success',
          loginWindowURL:string = this.loginURL + '/services/oauth2/authorize?client_id=' + this.appId + '&redirect_uri=' + deviceOauthCallback + '&response_type=token',
          successOauth:string = '/services/oauth2/success#access_token=',
          userDeniedAuth:string = '/services/oauth2/success?error=access_denied&error_description=end-user+denied+authorization',
          oauthTimeout:string = '/setup/secur/RemoteAccessErrorPage';
      
          if ((<any>window).cordova && (<any>window).cordova.InAppBrowser) {
              var ref = (<any>window).cordova.InAppBrowser.open(loginWindowURL, '_blank', 'location=no,zoom=no');
              ref.addEventListener('loadstop', (event) => {
                  if (event.url.indexOf(successOauth) > -1) {
                      this.oauthCallback(event.url);
                      ref.close();
                      Observable.empty<Object>();  
                  } else if (event.url.indexOf(userDeniedAuth) > -1) {
                    ref.close();
                    return Observable.throw(new Error('User denied authorization')); 
                  } else if (event.url.indexOf(oauthTimeout) > -1) {
                    ref.close();
                    return Observable.throw(new Error('Oauth timeout'));
                  }
              });
          } else {
              return Observable.throw(new Error('Cordova InAppBrowser plugin required'));
          }
    }

    private parseQueryString(queryString) {
        var qs = decodeURIComponent(queryString),
            obj = {},
            params = qs.split('&');

        params.forEach(function (param) {
          var splitter = param.split('=');
          if(splitter && splitter.length >= 2) obj[splitter[0]] = splitter[1];
        });
        return obj;
    };

    private oauthCallback(url) {
        let queryString: string, obj: any;

        if (url.indexOf("access_token=") > 0) {
            queryString = url.substr(url.indexOf('#') + 1);
            obj = this.parseQueryString(queryString);
            this.oauth = obj;
            this.tokenStore['forceOAuth'] = JSON.stringify(this.oauth);
            alert('this.deferredLogin.resolve("ok")');
            //this.deferredLogin.resolve('ok');
        } else if (url.indexOf("error=") > 0) {
            queryString = decodeURIComponent(url.substring(url.indexOf('?') + 1));
            obj = this.parseQueryString(queryString);
            alert('this.deferredLogin.reject("obj")');
            //this.deferredLogin.reject(obj);
        } else {
            alert('this.deferredLogin.reject({status: "access_denied"})');
        }
    }

    public getUserId() {
        return this.oauth ? this.oauth.id.split('/').pop() : undefined;
    }

    public isAuthenticated() {
        return this.oauth && this.oauth.access_token;
    }

    /** privates methods **/
  
    private getRequestBaseURL() {
        let url:string = this.serverURL;
        if (this.useProxy) url = this.proxyURL;
        else if (this.oauth.instance_url) url = this.oauth.instance_url;
        if (url.slice(-1) === '/') url = url.slice(0, -1);
        return url;
    }

    private toQueryString(obj) {
        var parts = [],i;
        for (i in obj) if (obj.hasOwnProperty(i)) parts.push(encodeURIComponent(i) + "=" + encodeURIComponent(obj[i]));
        return parts.join("&");
    }

    private refreshToken() : Observable<oAuthToken>{
      if (!this.oauth.refresh_token) return Observable.throw(new Error('No refresh token found'));
      let params:HttpParams = new HttpParams(), headers:HttpHeaders = new HttpHeaders(), url:any;
      const method = 'POST';
      
      // prepare http params
      params.append('grant_type', 'refresh_token');
      params.append('refresh_token', this.oauth.refresh_token);
      params.append('client_id', this.appId);
      // prepare url
      url = this.useProxy ? this.proxyURL : this.loginURL;
      if (url.slice(-1) === '/')  url = url.slice(0, -1);
      url = url + '/services/oauth2/token?' + this.toQueryString(params);
      if (this.useProxy) headers.append('Target-URL', this.loginURL);
      // Compose options       
      let options = {
        params: params,
        headers : headers,
        method : method
      };
       // Request
       return this.http.get<oAuthToken>(url, options);
    }

    public request(obj) {
      if (!this.oauth || (!this.oauth.access_token && !this.oauth.refresh_token)) return Observable.throw(new Error('No access token. Login and try again.')); 
       // Compose url
      let url:string = this.getRequestBaseURL(), 
        headers:HttpHeaders = new HttpHeaders(), 
        method:string = obj.method ? obj.method : 'GET', 
        options: any;
    
      if (obj.path.charAt(0) !== '/')  obj.path = '/' + obj.path;
      url = url + obj.path;

      //Compose headers
      headers.append('Authorization', 'Bearer ' + this.oauth.access_token);
      if (obj.contentType) headers.append('Content-Type', obj.contentType);
      if (this.useProxy) headers.append('Target-URL', this.oauth.instance_url);
      
      options = {
        params: obj.params,
        headers : headers,
        method : method,
        observe: 'response'
      };
    
      if (obj.responseType) options.responseType = obj.responseType;

      // Query
      return this.http.get(url, options).catch((err: HttpErrorResponse) => {
        if (err.status < 200 || err.status >= 300) {
          if (err.status === 401) {
            this.onlyOne = false;
            if (this.oauth.refresh_token) {
              this.refreshToken().subscribe(
                (data) => {
                    this.oauth.access_token = data.access_token;
                    this.tokenStore.forceOAuth = JSON.stringify(this.oauth);
                    return Observable.of<Object>(data); 
                },
                (error) => {return Observable.throw(err);}
              );
            }else{
              this.login().subscribe(
                x => console.log('request onNext: %s', x),
                e => console.log('request onError: %s', e),
                () => console.log('request onCompleted'))
                //return this.request(obj)
            }
          }else{
            return Observable.throw(err);
          }
        }
      });
    }
    public query(soql) {
        return this.request({
            path: '/services/data/' + this.apiVersion + '/query',
            params: {
                q: soql
            }
        });
    }

    public retrieve(objectName, id, fields) {
        return this.request({
            path: '/services/data/' + this.apiVersion + '/sobjects/' + objectName + '/' + id,
            params: fields ? {
                fields: fields
            } : undefined
        });
    }

    public create(objectName, data) {
        return this.request({
            method: 'POST',
            contentType: 'application/json',
            path: '/services/data/' + this.apiVersion + '/sobjects/' + objectName + '/',
            data: data
        });
    }

    public update(objectName, data) {
        var id = data.Id,
            fields = {...data};

        delete fields.attributes;
        delete fields.Id;

        return this.request({
            method: 'POST',
            contentType: 'application/json',
            path: '/services/data/' + this.apiVersion + '/sobjects/' + objectName + '/' + id,
            params: {
                '_HttpMethod': 'PATCH'
            },
            data: fields
        });
    }

    public del(objectName, id) {
        return this.request({
            method: 'DELETE',
            path: '/services/data/' + this.apiVersion + '/sobjects/' + objectName + '/' + id
        });
    }

    public upsert(objectName, externalIdField, externalId, data) {
        return this.request({
            method: 'PATCH',
            contentType: 'application/json',
            path: '/services/data/' + this.apiVersion + '/sobjects/' + objectName + '/' + externalIdField + '/' + externalId,
            data: data
        });
    }


    constructor(private http: HttpClient, private zone: NgZone) {
        (<any>window).angularComponentRef = {
            zone: this.zone,
            componentFn: (value) => this.oauthCallback(value),
            component: this
        };
        this.deferredLogin = {
            resolve: undefined,
            reject: undefined
        };
    }

    ngOnDestroy() {
        (<any>window).angularComponentRef = null;
    }
}
